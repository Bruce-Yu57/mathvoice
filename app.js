const $ = (s) => document.querySelector(s);
const fileInput = $('#fileInput');
const cameraInput = $('#cameraInput');
const problemInput = $('#problemInput');
const dropzone = $('#dropzone');
const preview = $('#imagePreview');
const previewImage = $('#previewImage');
const solveBtn = $('#solveBtn');
const boardContent = $('#boardContent');
const toast = $('#toast');

let currentFileUrl = null;
let currentImageFile = null;
let solutionSteps = [];
let currentStep = -1;
let lessonProblem = '';
let toastTimer;

const example = '解方程式：3(x − 2) = 2x + 5';
const examples = {
  title: '先把括號打開，讓 x 的係數看清楚',
  lines: ['3(x − 2) = 2x + 5', '3x − 6 = 2x + 5'],
  note: '左邊的 3 要乘進括號裡：3 乘 x 是 3x，3 乘 −2 就是 −6。',
  talk: '我們先讓式子變得比較好整理。左邊有一個括號，外面的三要分別乘進去：三乘 x 是三 x，三乘負二就是負六。所以原來的式子，現在變成三 x 減六，等於二 x 加五。'
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

function loadImage(file) {
  if (!file || !file.type.startsWith('image/')) { showToast('請選擇一張圖片檔案。'); return; }
  if (currentFileUrl) URL.revokeObjectURL(currentFileUrl);
  currentImageFile = file;
  currentFileUrl = URL.createObjectURL(file);
  previewImage.src = currentFileUrl;
  preview.hidden = false;
  showToast('圖片放上來了！可以直接請老師解題，不必再輸入題目文字。');
}

function clearImage() {
  if (currentFileUrl) URL.revokeObjectURL(currentFileUrl);
  currentFileUrl = null;
  currentImageFile = null;
  previewImage.removeAttribute('src');
  preview.hidden = true;
  fileInput.value = '';
  cameraInput.value = '';
}

function normalizeEquation(raw) {
  return raw.normalize('NFKC').replace(/[−–—]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/＝/g, '=').replace(/[，,。:：]/g, '').replace(/\s+/g, '');
}

// A small school algebra reader: expressions are represented as ax + b.
function readLinearExpression(source) {
  const text = source.replace(/\*/g, '');
  let i = 0;
  const peek = () => text[i];
  const take = () => text[i++];
  function number() {
    const start = i;
    while (/[0-9.]/.test(peek() || '')) take();
    if (start === i) throw new Error('少了數字或變數');
    const n = Number(text.slice(start, i));
    if (!Number.isFinite(n)) throw new Error('數字格式不太對');
    return [0, n];
  }
  function primary() {
    if (peek() === '+') { take(); return primary(); }
    if (peek() === '-') { take(); const [a,b] = primary(); return [-a,-b]; }
    if (peek() === '(') { take(); const result = expr(); if (take() !== ')') throw new Error('括號還沒有成對'); return result; }
    if (peek() === 'x' || peek() === 'X') { take(); return [1,0]; }
    if (/[0-9.]/.test(peek() || '')) return number();
    throw new Error('這題的式子我還讀不出來');
  }
  function term() {
    let out = primary();
    while (peek() === '*' || peek() === '/' || peek() === '(' || peek() === 'x' || peek() === 'X') {
      const explicit = peek() === '*' || peek() === '/';
      const op = explicit ? take() : '*'; const right = primary();
      if (op === '*') {
        if (out[0] !== 0 && right[0] !== 0) throw new Error('這個式子有 x 乘 x，已超出目前的範例解題範圍');
        out = [out[0]*right[1] + right[0]*out[1], out[1]*right[1]];
      } else {
        if (right[0] !== 0 || right[1] === 0) throw new Error('目前只能除以不含 x 的數');
        out = [out[0]/right[1], out[1]/right[1]];
      }
    }
    return out;
  }
  function expr() {
    let out = term();
    while (peek() === '+' || peek() === '-') {
      const op = take(); const right = term(); const k = op === '+' ? 1 : -1;
      out = [out[0]+k*right[0], out[1]+k*right[1]];
    }
    return out;
  }
  const result = expr();
  if (i !== text.length) throw new Error('式子的括號或運算符號需要再確認一下');
  return result;
}

function formatNumber(n) {
  if (Math.abs(n) < 1e-9) n = 0;
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return String(Number(n.toFixed(4)));
}
function formatSide([a,b]) {
  const bits = [];
  if (Math.abs(a) > 1e-9) bits.push(`${a === 1 ? '' : a === -1 ? '-' : formatNumber(a)}x`);
  if (Math.abs(b) > 1e-9 || !bits.length) bits.push(formatNumber(b));
  return bits.join(b >= 0 && bits.length > 1 ? ' + ' : '');
}
function cleanText(raw) { return raw.replace(/^解方程式[：:]?/,'').trim(); }

function buildLesson(raw) {
  const normalized = normalizeEquation(cleanText(raw));
  const sides = normalized.split('=');
  if (sides.length !== 2 || !sides[0] || !sides[1]) throw new Error('請輸入左右兩邊都有等號的一元一次方程式，例如 3(x-2)=2x+5');
  const left = readLinearExpression(sides[0]);
  const right = readLinearExpression(sides[1]);
  const steps = [];
  const containsParentheses = /\([^()]*\)/.test(sides[0] + sides[1]);
  const simplifiedLeft = `${formatSide(left)} = ${formatSide(right)}`;
  const initial = `${sides[0]} = ${sides[1]}`;

  if (containsParentheses) {
    const isOurExample = /3\s*\(\s*x\s*-\s*2\s*\)\s*=\s*2\s*x\s*\+\s*5/i.test(normalized);
    if (isOurExample) {
      steps.push({...examples, kind:'expand'});
    } else {
      steps.push({title:'先整理括號，讓式子變清楚', lines:[initial, simplifiedLeft], note:'先把括號裡的運算展開，再合併同類項。', talk:`我們先把括號整理開，接著把同類項放在一起，這樣更容易看出 x 的係數。這裡的式子整理後是：${spokenEquation(simplifiedLeft)}。`, kind:'expand'});
    }
  }

  let a = left[0] - right[0];
  let b = right[1] - left[1];
  const leftX = formatSide([a, 0]);
  const rightConstant = formatNumber(b);
  if (Math.abs(a) < 1e-9) throw new Error(Math.abs(b) < 1e-9 ? '左右兩邊一樣，這個方程式有很多個答案喔。' : '左右兩邊的 x 項抵消了，這題可能沒有解；請確認題目有沒有抄對。');

  const simpleLeft = !containsParentheses && (left[1] === 0 || right[1] === 0);
  if (!simpleLeft) {
    steps.push({title:'把 x 項留在同一邊', lines:[simplifiedLeft, `${leftX} = ${rightConstant}`], note:'等號兩邊同時移動含有 x 的項，記得移到另一側時符號會改變。', talk:`接著我們來整理含有 x 的項。等號兩邊同時減掉右邊的 ${formatNumber(right[0])} x，左邊保留 x 項，右邊的 x 項就消掉了。再把左邊的常數移到右邊，整理之後會得到：${spokenEquation(`${leftX}=${rightConstant}`)}。`});
  } else {
    const xPart = formatSide([a, 0]);
    const adjustedB = b;
    steps.push({title:'讓 x 留在等號的一邊',lines:[simplifiedLeft,`${xPart} = ${formatNumber(adjustedB)}`],note:'把 x 項整理到一側，常數整理到另一側。',talk:`我們把 x 項留在左邊，常數留在右邊。移項的時候，正號會變負號，負號會變正號。整理好之後就變成：${spokenEquation(`${xPart}=${formatNumber(adjustedB)}`)}。`});
  }

  const answer = b / a;
  const divisor = formatNumber(a);
  steps.push({title:`等號兩邊同除以 ${divisor}`,lines:[`${leftX} = ${rightConstant}`,`x = ${formatNumber(answer)}`],note:'係數乘在 x 旁邊，所以用除法把係數消掉。',talk:`現在 x 前面還乘著 ${divisor}，我們讓等號兩邊同時除以 ${divisor}。這樣左邊就只剩下 x，右邊算出來是 ${formatNumber(answer)}。`});
  steps.push({title:'把答案代回原式檢查',lines:[`${formatSide(left)} = ${formatSide(right)}`,`驗算：${formatNumber(left[0]*answer+left[1])} = ${formatNumber(right[0]*answer+right[1])}`,`所以 x = ${formatNumber(answer)}`],note:'左右兩邊算出相同的數，答案就對了。',talk:`最後我們把 x 等於 ${formatNumber(answer)} 代回原來的式子。左邊和右邊都算出 ${formatNumber(left[0]*answer+left[1])}，兩邊相等，所以答案正確。這題我們解出來了！`});

  // Tailor the final learning reminder to the kind of equation.
  const usedParentheses = containsParentheses;
  const topic = usedParentheses ? '這題的關鍵是「分配律」和「等量公理」。括號前的數要乘進每一項；移項時則要記得等號兩邊做相同的運算，等式才會保持平衡。' : '這題的關鍵是「等量公理」：等號兩邊同時做相同的加、減、乘、除，等式才會保持平衡。把含 x 的項和常數分開整理，最後再代回原式檢查，是解一元一次方程式的好習慣。';
  return { steps, topic };
}

function spokenEquation(s) {
  return s.replace(/([0-9.]+)x/g, (_, n) => `${n || '一'} x`).replace(/\bx\b/g,'x').replace(/=/g,'等於').replace(/\+/g,'加').replace(/-/g,'減').replace(/\*/g,'乘').replace(/\//g,'除以');
}

function say(text) {
  if (!('speechSynthesis' in window)) { showToast('這個瀏覽器目前不支援語音播放，可以繼續閱讀黑板上的解說。'); return; }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-TW'; utterance.rate = .91; utterance.pitch = 1.06; utterance.volume = 1;
  const voices = speechSynthesis.getVoices();
  const preferred = voices.find(v => /^zh-TW/i.test(v.lang) && /female|ting|mei|hui|sandy|yating|hsiao/i.test(v.name)) || voices.find(v => /^zh-TW/i.test(v.lang)) || voices.find(v => /^zh/i.test(v.lang));
  if (preferred) utterance.voice = preferred;
  speechSynthesis.speak(utterance);
}

function paintStep(index) {
  const step = solutionSteps[index];
  if (!step) return;
  const lines = step.lines.map(line => `<div>${escapeHtml(line)}</div>`).join('');
  boardContent.insertAdjacentHTML('beforeend', `<section class="chalk-step"><div class="step-number"><span>${index+1}</span> 第 ${index+1} 步</div><div class="step-title">${escapeHtml(step.title)}</div><div class="math-lines">${lines}<div class="math-note">${escapeHtml(step.note)}</div></div></section>`);
  currentStep = index;
  $('#progressArea').hidden = false;
  $('#progressText').textContent = `第 ${index+1} 步，共 ${solutionSteps.length} 步`;
  $('#progressBar').style.width = `${((index+1)/solutionSteps.length)*100}%`;
  $('#prevBtn').disabled = index === 0;
  $('#prevBtn').style.opacity = index === 0 ? '.48' : '1';
  const last = index === solutionSteps.length - 1;
  $('#nextLabel').textContent = last ? '完成這堂課' : index === -1 ? '開始講解' : '下一步';
  $('#nextBtn').onclick = nextStep;
  $('#encouragement').innerHTML = index === solutionSteps.length - 1 ? '<span>☼</span><span>太棒了，你把這題的思路走完了。<br/>記得看看今天帶走的數學重點！</span>' : '<span>☼</span><span>看完這一步，再按下一步繼續。<br/>不用急，慢慢想也可以。</span>';
  requestAnimationFrame(() => boardContent.scrollTo({top:boardContent.scrollHeight,behavior:'smooth'}));
  say(step.talk);
  if (last) {
    $('#metaBox').hidden = false;
    $('#metaText').textContent = lessonTopic;
    $('#nextLabel').textContent = '再聽一次最後一步';
  }
}
let lessonTopic = '';
function nextStep() {
  if (currentStep < 0) { paintStep(0); return; }
  if (currentStep < solutionSteps.length - 1) { paintStep(currentStep+1); return; }
  say(solutionSteps[currentStep].talk);
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

function showLesson(problem, lesson) {
  lessonProblem = problem; solutionSteps = lesson.steps; lessonTopic = lesson.topic; currentStep = -1;
  $('#progressArea').hidden = true; $('#metaBox').hidden = true; $('#lessonControls').hidden = false;
  $('#lessonControls').style.display = 'flex'; $('#nextLabel').textContent = '開始講解';
  $('#prevBtn').onclick = () => { if(currentStep > 0) { boardContent.querySelectorAll('.chalk-step').forEach((el,i) => { if(i >= currentStep) el.remove(); }); paintStep(currentStep-1); } };
  boardContent.innerHTML = `<div class="problem-on-board"><span class="board-problem-label">今天的題目</span>${escapeHtml(problem)}</div>`;
  $('#encouragement').innerHTML = '<span>☼</span><span>題目讀好了，我們一起來解。<br/>按下「開始講解」就能從第一步開始。</span>';
  boardContent.scrollTop = 0;
  document.querySelector('.lesson-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
}

async function solveWithGroq(imageFile, text) {
  if (location.protocol === 'file:') {
    throw new Error('題目已準備好。請透過網站網址使用 Groq 解題服務，就能開始辨識和講解。');
  }
  const form = new FormData();
  if (imageFile) {
    const preparedImage = await prepareImage(imageFile);
    form.append('image', preparedImage, preparedImage.name || 'question.jpg');
  }
  if (text) form.append('text', text);
  let response;
  try {
    response = await fetch('/api/solve', { method: 'POST', body: form });
  } catch {
    throw new Error('目前連不到 AI 解題服務。題目不用重傳，請稍後再試。');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || '老師暫時沒有解讀成功，請確認題目清楚後再試一次。');
  if (!result.problem || !Array.isArray(result.steps) || result.steps.length < 3 || result.steps.length > 6 || !result.topic || result.steps.some(step => !step.title || !Array.isArray(step.lines) || !step.note || !step.talk)) {
    throw new Error('老師收到題目了，但講解內容不完整，請稍後再試。');
  }
  return { problem: result.problem, lesson: { steps: result.steps, topic: result.topic } };
}

async function prepareImage(file) {
  if (file.size <= 3.5 * 1024 * 1024) return file;
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('這張圖片太大，且目前裝置無法縮小它。請重新截取較小範圍的題目照片。'); }
  try {
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.84, 0.72, 0.6]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 3.5 * 1024 * 1024) return new File([blob], 'question.jpg', { type: 'image/jpeg' });
    }
  } finally { bitmap.close(); }
  throw new Error('圖片仍然太大，請重新截取較小範圍的題目照片。');
}

async function startLesson() {
  const raw = problemInput.value.trim();
  if (!raw && !currentImageFile) { showToast('先輸入題目，或貼上一張題目照片吧。'); problemInput.focus(); return; }
  solveBtn.disabled = true;
  solveBtn.querySelector('span:first-child').textContent = currentFileUrl ? '老師正在看題目…' : '老師正在整理解法…';
  try {
    const result = await solveWithGroq(currentImageFile, raw);
    showLesson(result.problem, result.lesson);
  } catch (err) { showToast(err.message); }
  finally {
    solveBtn.disabled = false;
    solveBtn.querySelector('span:first-child').textContent = '請老師幫我解題';
  }
}

$('#chooseBtn').addEventListener('click',e=>{e.stopPropagation();fileInput.click();});
dropzone.addEventListener('click',e=>{if(!e.target.closest('button') && !e.target.closest('label'))fileInput.click();});
dropzone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fileInput.click();}});
fileInput.addEventListener('change',()=>loadImage(fileInput.files[0]));
cameraInput.addEventListener('change',()=>loadImage(cameraInput.files[0]));
$('#removeImage').addEventListener('click',clearImage);
['dragenter','dragover'].forEach(event=>dropzone.addEventListener(event,e=>{e.preventDefault();dropzone.classList.add('dragging');}));
['dragleave','drop'].forEach(event=>dropzone.addEventListener(event,e=>{e.preventDefault();dropzone.classList.remove('dragging');}));
dropzone.addEventListener('drop',e=>loadImage(e.dataTransfer.files[0]));
document.addEventListener('paste',e=>{const image=[...e.clipboardData.items].find(item=>item.type.startsWith('image/'));if(image){loadImage(image.getAsFile());showToast('截圖貼上成功！可以直接請老師解題，不必輸入文字。');}});
$('#exampleBtn').addEventListener('click',()=>{problemInput.value=example;problemInput.focus();});
solveBtn.addEventListener('click',startLesson);
$('#readQuestion').addEventListener('click',()=>say(`今天的題目是：${lessonProblem}。`));
$('#readMeta').addEventListener('click',()=>say(lessonTopic));
$('#aboutBtn').addEventListener('click',()=>$('#helpDialog').showModal());
$('#closeDialog').addEventListener('click',()=>$('#helpDialog').close());
$('#gotIt').addEventListener('click',()=>$('#helpDialog').close());
$('#helpDialog').addEventListener('click',e=>{if(e.target===$('#helpDialog'))$('#helpDialog').close();});


