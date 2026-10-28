const Busboy = require('busboy');

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const GEMINI_MODEL = 'gemini-3.8-flash';
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/avif'
]);

const responseSchema = {
  type: 'OBJECT',
  properties: {
    problem: { type: 'STRING', description: 'Read the one intended math problem, faithfully transcribed in Traditional Chinese.' },
    steps: {
      type: 'ARRAY', minItems: 3, maxItems: 6,
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          lines: { type: 'ARRAY', items: { type: 'STRING' } },
          note: { type: 'STRING', description: 'Short, student-friendly note to display on the chalkboard.' },
          talk: { type: 'STRING', description: 'Natural spoken Traditional Chinese explanation. Teach the idea; do not read the equations aloud.' }
        },
        required: ['title', 'lines', 'note', 'talk']
      }
    },
    topic: { type: 'STRING', description: 'A concise metacognitive recap of the key junior-high math idea and a useful self-check.' }
  },
  required: ['problem', 'steps', 'topic']
};

function readMultipart(req) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({ headers: req.headers, limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 1, parts: 2 } });
    } catch {
      reject(Object.assign(new Error('請重新選擇題目，再試一次。'), { status: 400 }));
      return;
    }
    const fields = {};
    let image = null;
    let tooLarge = false;
    parser.on('field', (name, value) => { fields[name] = value; });
    parser.on('file', (name, stream, info) => {
      if (name !== 'image' || !ALLOWED_IMAGE_TYPES.has(info.mimeType)) {
        stream.resume();
        reject(Object.assign(new Error('請上傳 JPG、PNG、WebP 或手機支援的圖片格式。'), { status: 415 }));
        return;
      }
      const chunks = [];
      stream.on('limit', () => { tooLarge = true; });
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => { image = { mimeType: info.mimeType, data: Buffer.concat(chunks).toString('base64') }; });
    });
    parser.on('error', reject);
    parser.on('finish', () => {
      if (tooLarge) return reject(Object.assign(new Error('圖片太大了，請縮小或重新截取題目後再試。'), { status: 413 }));
      if (!image && !String(fields.text || '').trim()) return reject(Object.assign(new Error('請提供題目圖片或文字。'), { status: 400 }));
      resolve({ image, text: String(fields.text || '').trim() });
    });
    req.pipe(parser);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '此服務只接受題目提交。' });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'Gemini 服務尚未設定，完成部署後就能開始解題。' });
  }

  try {
    const { image, text } = await readMultipart(req);
    const prompt = [
      '你是一位耐心、親切的台灣國中數學女老師，使用繁體中文。',
      '學生年級範圍是七至九年級。題目可能在雜亂照片中；只辨識最主要的一大題，忽略頁碼、邊緣雜訊、筆記和其他小題。',
      '若有圖片，請仔細讀取數字、符號、單位、圖形標示與文字。不要自行補造看不清楚的資訊；無法判讀時，problem 要清楚說明看不清楚，並在 topic 說明應重新拍攝。',
      '逐步教學需分成 3 到 6 步，依題目難度調整。每步 lines 是適合寫在黑板上的短算式或文字；note 是簡潔提示；talk 是口語化教學，要解釋為什麼這樣做、引導學生思考，不要逐字朗讀 lines。',
      '只使用國中七至九年級會學到的方法。計算要核對，答案要合理。最後 topic 用學生聽得懂的方式總結學科觀念、常見錯誤或自我檢查方法。',
      text ? `學生附上的題目文字（若與圖片不同，優先使用圖片中最清楚的主要題目，並保留重要條件）：\n${text}` : '請直接根據圖片辨識主要題目。'
    ].join('\n\n');
    const parts = [{ text: prompt }];
    if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000);
    let upstream;
    try {
      upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseMimeType: 'application/json', responseSchema }
        }),
        signal: controller.signal
      });
    } finally { clearTimeout(timeout); }

    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : 502;
      return res.status(status).json({ error: status === 429 ? '老師現在有點忙，請稍等一下再試。' : '題目暫時沒有辨識成功，請確認照片清楚後再試。' });
    }
    const generated = payload.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
    if (!generated) return res.status(502).json({ error: '老師沒有收到完整的解題內容，請再試一次。' });
    const result = JSON.parse(generated);
    if (typeof result.problem !== 'string' || typeof result.topic !== 'string' || !Array.isArray(result.steps) || result.steps.length < 3 || result.steps.length > 6) {
      return res.status(502).json({ error: '講解內容格式不完整，請再試一次。' });
    }
    return res.status(200).json(result);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 502;
    return res.status(status).json({ error: status < 500 ? error.message : '老師暫時沒有解讀成功，請稍後再試。' });
  }
};

module.exports.config = { api: { bodyParser: false }, maxDuration: 60 };

