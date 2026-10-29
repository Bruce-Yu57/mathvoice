const Busboy = require('busboy');

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const GROQ_TIMEOUT_MS = 35_000;
const GROQ_MODEL = 'qwen/qwen3.8-27b';
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp'
]);

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    problem: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          lines: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
          talk: { type: 'string' }
        },
        required: ['title', 'lines', 'note', 'talk'],
        additionalProperties: false
      }
    },
    topic: { type: 'string' }
  },
  required: ['problem', 'steps', 'topic'],
  additionalProperties: false
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
  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'Groq 服務尚未設定，完成部署後就能開始解題。' });
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
    const userContent = image ? [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }
    ] : prompt;
    const retryDeadline = Date.now() + 45_000;
    const maxAttempts = 3;
    let upstream;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const remainingMs = retryDeadline - Date.now();
      if (remainingMs < 2_000) break;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(GROQ_TIMEOUT_MS, remainingMs - 1_000));
      try {
        upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [
              { role: 'system', content: '你是一位台灣國中數學老師。請依照使用者要求解題，使用繁體中文，最後只輸出一個合法 JSON 物件，不要加 Markdown 程式碼區塊。' },
              { role: 'user', content: userContent }
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'junior_high_math_lesson',
                strict: true,
                schema: RESPONSE_SCHEMA
              }
            },
            reasoning_format: 'hidden',
            reasoning_effort: 'low',
            max_completion_tokens: 4096
          }),
          signal: controller.signal
        });
      } finally { clearTimeout(timeout); }

      const retryable = [429, 500, 502, 503, 504].includes(upstream.status);
      if (!retryable || attempt === maxAttempts - 1) break;

      await upstream.arrayBuffer().catch(() => {});
      const delayMs = 500 * (2 ** attempt) + Math.floor(Math.random() * 300);
      if (Date.now() + delayMs + 2_000 >= retryDeadline) break;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error('Groq request failed', {
        status: upstream.status,
        code: payload.error?.code || payload.error?.type || null,
        message: String(payload.error?.message || 'No error message returned').slice(0, 500)
      });
      const status = upstream.status === 429 ? 429 : upstream.status === 503 ? 503 : 502;
      const error = status === 503
        ? 'Groq 目前暫時忙碌，請稍等一下再試。'
        : status === 429
          ? '老師現在有點忙，請稍等一下再試。'
          : '題目暫時沒有辨識成功，請確認照片清楚後再試。';
      return res.status(status).json({ error });
    }
    const generated = payload.choices?.[0]?.message?.content;
    if (!generated) return res.status(502).json({ error: '老師沒有收到完整的解題內容，請再試一次。' });
    const result = JSON.parse(generated);
    if (typeof result.problem !== 'string' || typeof result.topic !== 'string' || !Array.isArray(result.steps) || result.steps.length < 3 || result.steps.length > 6) {
      return res.status(502).json({ error: '講解內容格式不完整，請再試一次。' });
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('Solve function failed', {
      name: error.name || 'Error',
      message: String(error.message || 'Unknown error').slice(0, 300)
    });
    const status = Number.isInteger(error.status) ? error.status : 502;
    return res.status(status).json({ error: status < 500 ? error.message : '老師暫時沒有解讀成功，請稍後再試。' });
  }
};

module.exports.config = { api: { bodyParser: false }, maxDuration: 60 };

