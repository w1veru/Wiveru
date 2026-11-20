const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage, session, clipboard } = require('electron');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const sudo = require('sudo-prompt');

app.disableHardwareAcceleration();

const ZAPRET_DIR = path.join(app.getAppPath(), 'zapret');
const ZAPRET_GENERAL = path.join(ZAPRET_DIR, 'general.bat');
const ZAPRET_STATUS_PS1 = path.join(app.getAppPath(), 'zapret-status.ps1');
const MODEL_CANDIDATES = [
  'Qwen3-8B-Q4_K_M.gguf',
  'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  'Qwen3-4B-Instruct-2507-Q4_K_M.gguf'
];
const MODEL_PATH = MODEL_CANDIDATES
  .map((f) => path.join(app.getAppPath(), 'models', f))
  .find((p) => fs.existsSync(p)) || path.join(app.getAppPath(), 'models', MODEL_CANDIDATES[0]);

let win;
let tray;

const WINDOW = { width: 600, height: 340 };

// ---------- Zapret ----------

let adminCache = null;
function isElevated() {
  if (adminCache !== null) return Promise.resolve(adminCache);
  return new Promise((resolve) => {
    exec('whoami /groups | findstr /i "S-1-16-12288"', (err, stdout) => {
      adminCache = !err && stdout.includes('S-1-16-12288');
      resolve(adminCache);
    });
  });
}

function isZapretRunning() {
  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${ZAPRET_STATUS_PS1}"`,
      { timeout: 15000 },
      (err, stdout) => resolve(!err && /^\s*ON\s*$/im.test(stdout))
    );
  });
}

function elevate(command) {
  return new Promise((resolve) => {
    sudo.exec(command, { name: 'Wiveru', env: { NO_UPDATE_CHECK: '1' } }, (err, stdout, stderr) => {
      zapretLog('elevate err=' + (err && err.message) +
        ' out=' + String(stdout || '').slice(0, 300) +
        ' errout=' + String(stderr || '').slice(0, 300));
      resolve(!err);
    });
  });
}

const ZAPRET_OFF_CMD =
  'taskkill /F /IM winws.exe & net stop zapret & sc delete zapret';

function zapretLog(msg) {
  try {
    fs.appendFileSync(path.join(app.getAppPath(), 'zapret.log'),
      new Date().toISOString() + ' ' + msg + '\n');
  } catch {}
}

function voiceLog(msg) {
  zapretLog('voice: ' + String(msg).slice(0, 300));
}

function runHidden(command, cwd) {
  const child = spawn('cmd.exe', ['/c', command], {
    windowsHide: true,
    cwd: cwd || ZAPRET_DIR,
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

function zapretServiceBinPath() {
  return new Promise((resolve) => {
    exec('sc qc zapret', { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = String(stdout).match(/BINARY_PATH_NAME\s*:\s*(.+)/i);
      resolve(m ? m[1].trim().replace(/^"|"$/g, '') : null);
    });
  });
}

const SETTINGS_PATH = path.join(app.getAppPath(), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const merged = { ...readSettings(), ...patch };
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2));
  } catch {}
  return merged;
}

async function findZapretBat() {
  const found = [];
  const check = (p) => { if (p && fs.existsSync(p) && !found.includes(p)) found.push(p); };

  const custom = readSettings().zapretBat;
  if (custom) check(custom);
  check(ZAPRET_GENERAL);

  const bin = await zapretServiceBinPath();
  if (bin) {
    const dir = path.dirname(bin);
    check(path.join(dir, 'general.bat'));
    check(path.join(path.dirname(dir), 'general.bat'));
  }

  try {
    const home = os.homedir();
    const roots = [home, path.join(home, 'Desktop'), path.join(home, 'Downloads'),
      path.join(home, 'Documents'), 'C:\\', 'D:\\', 'E:\\', 'F:\\'];
    for (const root of roots) {
      let entries;
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || !/zapret/i.test(e.name)) continue;
        check(path.join(root, e.name, 'general.bat'));
      }
    }
  } catch {}
  return found;
}

// ---------- Gemini (cloud, free tier + Google Search grounding) ----------

const GEMINI_MODEL = 'gemini-2.5-flash';
let geminiHistory = [];

function readAIConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'ai-config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function writeAIConfig(patch) {
  const merged = { ...readAIConfig(), ...patch };
  try {
    fs.writeFileSync(path.join(app.getAppPath(), 'ai-config.json'), JSON.stringify(merged, null, 2));
  } catch {}
  return merged;
}

function geminiRequest(apiKey, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      },
      (res) => {
        let out = '';
        res.on('data', (c) => { out += c; });
        res.on('end', () => {
          try {
            const j = JSON.parse(out);
            if (j.error) return reject(new Error(j.error.message || 'Gemini API error'));
            const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
            const text = Array.isArray(parts) ? parts.map((p) => p.text || '').join('').trim() : '';
            resolve(text);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

async function geminiChat(apiKey, question) {
  const contents = [
    ...geminiHistory,
    { role: 'user', parts: [{ text: question }] }
  ];
  const text = await geminiRequest(apiKey, {
    contents,
    tools: [{ google_search: {} }],
    systemInstruction: {
      parts: [{ text: 'Ты — ИИ-ассистент Wiveru, девушка. Всегда говори о себе в женском роде («поняла», «сделала», «открыла», «рада помочь»), а к пользователю обращайся в мужском роде («ты понял», «готов», «сделал»). Отвечай точно, полезно и по делу на языке пользователя. Для актуальных данных используй поиск Google. Если вопрос требует инструкции — давай подробный ответ с шагами.' }]
    },
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
  });
  geminiHistory.push({ role: 'user', parts: [{ text: question }] });
  geminiHistory.push({ role: 'model', parts: [{ text }] });
  if (geminiHistory.length > 20) geminiHistory = geminiHistory.slice(-20);
  return text;
}

// ---------- OpenAI-compatible API (Groq, OpenRouter, GitHub Models, Pollinations...) ----------

let openAIHistory = [];

function openAICompatChat(cfg, question) {
  return new Promise((resolve, reject) => {
    const base = (cfg.baseUrl || '').replace(/\/+$/, '');
    const url = new URL(base + '/chat/completions');
    const body = JSON.stringify({
      model: cfg.model || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'Ты — ИИ-ассистент Wiveru, девушка. Всегда говори о себе в женском роде («поняла», «сделала», «открыла», «рада помочь»), а к пользователю обращайся в мужском роде («ты понял», «готов», «сделал»). Отвечай точно, полезно и по делу на языке пользователя. Если вопрос требует инструкции — давай подробный ответ с шагами.' },
        ...openAIHistory,
        { role: 'user', content: question }
      ],
      temperature: 0.7,
      max_tokens: 1024
    });
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
    const req = https.request(url, { method: 'POST', headers }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(out);
          if (j.error) return reject(new Error(j.error.message || 'API error'));
          const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          resolve(String(text || '').trim());
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

async function openAICompatAnswer(cfg, question) {
  const text = await openAICompatChat(cfg, question);
  openAIHistory.push({ role: 'user', content: question });
  openAIHistory.push({ role: 'assistant', content: text });
  if (openAIHistory.length > 20) openAIHistory = openAIHistory.slice(-20);
  return text;
}

// ---------- Voice (Whisper STT) ----------

function groqConfig() {
  const cfg = readAIConfig();
  return {
    base: (cfg.sttBaseUrl || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
    key: cfg.sttApiKey || ''
  };
}

async function transcribeAudio(base64, mime) {
  const { base, key } = groqConfig();
  if (!base || !key) throw new Error('no-api-key');
  const audio = Buffer.from(base64, 'base64');
  const boundary = '----wiveru' + Date.now();
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: ${mime || 'audio/webm'}\r\n\r\n`
  );
  const mid = Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nru\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="temperature"\r\n\r\n0\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nВиверу Вивер Ведро Веру Остров Островок — голосовой помощник. Который час? Сколько времени? Во сколько? Какая погода? Которое сегодня число? Пауза. Стоп. Продолжи. Следующий трек. Предыдущий. Громче. Тише. Выключи звук. Включи музыку. Что ты умеешь?\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n` +
    `--${boundary}--\r\n`
  );
  const body = Buffer.concat([head, audio, mid]);
  const u = new URL(base + '/audio/transcriptions');
  const attempt = () => new Promise((resolve, reject) => {
    const req = https.request(u, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(out);
          if (j.error) return reject(new Error(j.error.message || 'STT error'));
          resolve(String(j.text || '').trim());
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const text = await attempt();
      if (i > 0) voiceLog('stt retry ok attempt ' + (i + 1));
      return text;
    } catch (e) {
      lastErr = e;
      voiceLog('stt attempt ' + (i + 1) + ' fail: ' + (e && e.message ? e.message : e));
      if (i < 2) await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw lastErr;
}

// ---------- Local Whisper STT (offline, works in RF without VPN) ----------

let sttProc = null;
let sttReady = null;
let sttSeq = 0;
const sttPending = new Map();

function ensureSttServer() {
  if (sttReady) return sttReady;
  sttReady = new Promise((resolve, reject) => {
    const root = app.getAppPath();
    const py = path.join(root, 'stt-venv', 'Scripts', 'python.exe');
    const script = path.join(root, 'stt_server.py');
    if (!fs.existsSync(py) || !fs.existsSync(script)) return reject(new Error('no-local-stt'));
    try { fs.mkdirSync(path.join(root, '.tmp'), { recursive: true }); } catch {}
    const env = Object.assign({}, process.env, {
      HF_HOME: path.join(root, 'hf-cache'),
      HF_HUB_OFFLINE: '1',
      TMP: path.join(root, '.tmp'), TEMP: path.join(root, '.tmp'),
      PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'
    });
    const p = spawn(py, [script], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    sttProc = p;
    let buf = '';
    const bootTimer = setTimeout(() => reject(new Error('stt-server-timeout')), 180000);
    p.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.ready) {
          clearTimeout(bootTimer);
          voiceLog('local stt ready model=' + (msg.model || '?'));
          resolve();
        } else if (msg.id !== undefined && sttPending.has(msg.id)) {
          const pnd = sttPending.get(msg.id);
          sttPending.delete(msg.id);
          msg.error ? pnd.rej(new Error(msg.error)) : pnd.res(msg.text);
        }
      }
    });
    p.stderr.on('data', () => {});
    p.on('error', (e) => { sttProc = null; sttReady = null; reject(e); });
    p.on('exit', () => {
      sttProc = null; sttReady = null;
      for (const pnd of sttPending.values()) pnd.rej(new Error('stt-server-exit'));
      sttPending.clear();
    });
  });
  return sttReady;
}

async function transcribeAudioLocal(base64, mime) {
  await ensureSttServer();
  const m = String(mime || '');
  const ext = m.includes('ogg') ? 'ogg' : m.includes('mp4') || m.includes('m4a') ? 'm4a' : m.includes('wav') ? 'wav' : 'webm';
  const dir = path.join(app.getAppPath(), '.stt-tmp');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, 'a-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext);
  fs.writeFileSync(fp, Buffer.from(base64, 'base64'));
  const id = ++sttSeq;
  try {
    return await new Promise((resolve, reject) => {
      sttPending.set(id, { res: resolve, rej: reject });
      sttProc.stdin.write(JSON.stringify({ id, path: fp }) + '\n');
      setTimeout(() => {
        if (sttPending.has(id)) {
          sttPending.delete(id);
          reject(new Error('stt-timeout'));
        }
      }, 90000);
    });
  } finally {
    try { fs.unlinkSync(fp); } catch {}
  }
}

// ---------- GigaAM STT (sherpa-onnx, offline, Russian) ----------

let gigaRecognizer = null;
let gigaTried = false;

function getGigaRecognizer() {
  if (gigaRecognizer || gigaTried) return gigaRecognizer;
  gigaTried = true;
  try {
    const gdir = path.join(app.getAppPath(), 'models', 'gigaam');
    const sub = fs.existsSync(gdir) ? fs.readdirSync(gdir).filter((d) => fs.statSync(path.join(gdir, d)).isDirectory()) : [];
    if (!sub.length) return null;
    const mdir = path.join(gdir, sub[0]);
    const files = fs.readdirSync(mdir);
    const pick = (re) => { const f = files.find((x) => re.test(x)); return f ? path.join(mdir, f) : null; };
    const sherpa = require('sherpa-onnx');
    const modelFile = pick(/encoder.*\.onnx$/i) || pick(/model.*\.onnx$/i) || pick(/\.onnx$/i);
    const tokensFile = pick(/tokens.*\.txt$/i);
    if (!modelFile || !tokensFile) { voiceLog('gigaam files missing: ' + files.join(',')); return null; }
    gigaRecognizer = sherpa.createOfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        nemoCtc: { model: modelFile },
        tokens: tokensFile,
        numThreads: 4,
        provider: 'cpu',
        debug: 0
      }
    });
    voiceLog('gigaam ready: ' + sub[0]);
  } catch (e) {
    voiceLog('gigaam init fail: ' + (e && e.message ? e.message : e));
    gigaRecognizer = null;
  }
  return gigaRecognizer;
}

async function transcribePcmGiga(samples) {
  const rec = getGigaRecognizer();
  if (!rec) throw new Error('no-gigaam');
  const stream = rec.createStream();
  stream.acceptWaveform(16000, samples);
  rec.decode(stream);
  const text = String((rec.getResult(stream) || {}).text || '').trim();
  try { if (stream.free) stream.free(); } catch {}
  return text;
}

// ---------- Local AI (node-llama-cpp) ----------

let llama = null;
let model = null;
let aiContext = null;
let aiSession = null;
let aiLoading = null;

function sendAIStatus(state) {
  if (win && !win.isDestroyed()) win.webContents.send('ai-status', state);
}

async function ensureAI() {
  if (aiSession) return aiSession;
  if (aiLoading) return aiLoading;
  aiLoading = (async () => {
    sendAIStatus('loading');
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
    llama = await getLlama();
    model = await llama.loadModel({ modelPath: MODEL_PATH });
    aiContext = await model.createContext({ contextSize: 4096 });
    aiSession = new LlamaChatSession({
      contextSequence: aiContext.getSequence(),
      systemPrompt: 'Ты — ИИ-ассистент Wiveru, девушка. Всегда говори о себе в женском роде («поняла», «сделала», «открыла», «рада помочь»), а к пользователю обращайся в мужском роде («ты понял», «готов», «сделал»). Отвечай точно, полезно и по делу на языке пользователя. Если для точного или актуального ответа нужны данные из интернета (свежие новости, инструкции, настройки игр и т.п.) — выведи ОТДЕЛЬНОЙ строкой ровно: SEARCH: <поисковый запрос> и больше ничего не пиши. После этого ты получишь результаты поиска и сможешь дать финальный ответ. Если поиск не нужен — сразу отвечай. Если вопрос требует инструкции — давай подробный ответ с шагами.'
    });
    sendAIStatus('ready');
    return aiSession;
  })();
  try {
    return await aiLoading;
  } catch (e) {
    sendAIStatus('error');
    throw e;
  } finally {
    aiLoading = null;
  }
}

async function unloadAI() {
  const s = aiSession, c = aiContext, m = model, l = llama;
  aiSession = aiContext = model = llama = null;
  aiLoading = null;
  try { if (s) await s.dispose(); } catch {}
  try { if (c) await c.dispose(); } catch {}
  try { if (m) await m.dispose(); } catch {}
  try { if (l) await l.dispose(); } catch {}
  sendAIStatus('unloaded');
}

function stripHtml(s) {
  return String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").trim();
}

function webSearch(query) {
  return new Promise((resolve) => {
    const lang = /[а-яё]/i.test(query) ? 'ru' : 'en';
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=4&format=json`;
    exec(
      `powershell -NoProfile -Command "(Invoke-RestMethod -Uri '${url}' -TimeoutSec 8).query.search | ConvertTo-Json -Compress"`,
      { timeout: 12000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err) { resolve([]); return; }
        try {
          let data = JSON.parse(stdout.trim() || '[]');
          if (!Array.isArray(data)) data = [data];
          resolve(data.map((r) => ({ title: r.title, snippet: stripHtml(r.snippet) })).filter((r) => r.title));
        } catch {
          resolve([]);
        }
      }
    );
  });
}

// ---------- Window ----------

// GPU stats кэшируются: si.graphics() через WMI отвечает секундами,
// поэтому обновляем в фоне, а get-load отдаёт свежий CPU/RAM сразу.
let gpuCache = { ts: 0, data: null, name: '' };
let gpuBusy = false;

async function refreshGpu() {
  if (gpuBusy) return;
  gpuBusy = true;
  try {
    const si = await import('systeminformation');
    const gfx = await si.graphics().catch(() => null);
    const ctrls = gfx && Array.isArray(gfx.controllers) ? gfx.controllers : [];
    const gpu = ctrls.reduce((best, c) =>
      (!best || (c.utilizationGpu || 0) > (best.utilizationGpu || 0) ? c : best), null);
    gpuCache = {
      ts: Date.now(),
      name: gpu ? (gpu.model || gpu.name || '') : '',
      data: gpu ? {
        util: typeof gpu.utilizationGpu === 'number' ? Math.round(gpu.utilizationGpu) : null,
        temp: typeof gpu.temperatureGpu === 'number' ? Math.round(gpu.temperatureGpu) : null,
        power: typeof gpu.powerDraw === 'number' ? Math.round(gpu.powerDraw) : null,
        memUsed: gpu.memoryUsed, memTotal: gpu.memoryTotal
      } : null
    };
  } catch {} finally {
    gpuBusy = false;
  }
}

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.round((width - WINDOW.width) / 2);
  const y = 8;

  win = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    x,
    y,
    title: 'Wiveru',
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  win.on('hide', () => {
    console.log('WINDOW HIDDEN:', new Error().stack);
    unloadAI();
    win.webContents.send('win-hidden');
  });
  win.on('show', () => {
    win.webContents.send('win-shown');
  });

  win.show();
  win.loadFile('index.html');
  win.on('did-finish-load', () => win.show());
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    win.webContents.send('cursor-pos', { x: p.x - b.x, y: p.y - b.y });
  }, 80);
}

ipcMain.on('mouse-guard', (event, on) => {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!on, { forward: true });
});

ipcMain.handle('desktop-source-id', async () => {
  try {
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    return sources.length ? sources[0].id : null;
  } catch {
    return null;
  }
});

ipcMain.on('win-height', (event, h) => {
  if (!win || win.isDestroyed()) return;
  const H = Math.min(700, Math.max(300, Math.round(Number(h) || WINDOW.height)));
  if (win.getSize()[1] !== H) win.setSize(WINDOW.width, H);
});

function createTray() {
  const iconPath = path.join(app.getAppPath(), 'tray.png');
  const img = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('Wiveru');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Показать', click: () => win && win.show() },
    { label: 'Выход', click: () => app.quit() }
  ]));
  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible()) win.hide();
    else win.show();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
app.on('second-instance', () => {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.whenReady().then(() => {
  ensureSttServer().catch((e) => voiceLog('local stt warmup fail: ' + (e && e.message ? e.message : e)));
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media');
  });

  ipcMain.handle('get-uptime', () => new Promise((resolve) => {
    exec(
      'powershell -NoProfile -Command "[int]((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalSeconds"',
      { timeout: 10000 },
      (err, stdout) => {
        const secs = parseInt(stdout, 10);
        resolve(Number.isFinite(secs) && secs > 0 ? secs : os.uptime());
      }
    );
  }));

  function httpsJson(url) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Wiveru/1.0' }, timeout: 8000 }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('http ' + res.statusCode)); }
        let out = '';
        res.on('data', (c) => { out += c; });
        res.on('end', () => { try { resolve(JSON.parse(out)); } catch (e) { reject(e); } });
      }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
    });
  }

  const artCache = new Map();
  const artPending = new Map();

  async function findCoverArt(artist, title) {
    const q = [artist, title].filter(Boolean).join(' ').trim();
    if (!q) return null;
    const key = q.toLowerCase();
    if (artCache.has(key)) return artCache.get(key);
    if (artPending.has(key)) return artPending.get(key);
    const p = (async () => {
      try {
        const j = await httpsJson('https://api.deezer.com/search?q=' + encodeURIComponent(q) + '&limit=1');
        const u = j && j.data && j.data[0] && j.data[0].album && j.data[0].album.cover_xl;
        if (u) return u;
      } catch {}
      try {
        const j = await httpsJson('https://itunes.apple.com/search?term=' + encodeURIComponent(q) + '&entity=song&limit=1');
        const u = j && j.results && j.results[0] && j.results[0].artworkUrl100;
        if (u) return u.replace('100x100bb', '600x600bb');
      } catch {}
      return null;
    })();
    artPending.set(key, p);
    try {
      const url = await p;
      artCache.set(key, url);
      if (artCache.size > 200) artCache.delete(artCache.keys().next().value);
      return url;
    } finally {
      artPending.delete(key);
    }
  }

  ipcMain.handle('get-media', async () => {
    try {
      const { sessions, current } = await import('now-playing-media');
      let session = null;
      try {
        const list = await sessions();
        const playing = (list || []).filter((s) => s && s.track && s.playback && s.playback.status === 'Playing');
        if (playing.length) {
          // среди играющих выбираем ту, чья позиция реально движется
          if (!global.__mediaPos) global.__mediaPos = {};
          const now = Date.now();
          let best = null, bestDelta = -1;
          for (const s of playing) {
            const prev = global.__mediaPos[s.id];
            const pos = s.playback.positionMs || 0;
            const delta = prev ? Math.max(0, pos - prev.pos) : 0;
            global.__mediaPos[s.id] = { pos, ts: now };
            const score = delta + (prev && now - prev.ts < 8000 ? 1 : 0);
            if (score > bestDelta) { bestDelta = score; best = s; }
          }
          session = best || playing[0];
        }
      } catch {}
      if (!session) session = await current();
      if (!session || !session.track) {
        return null;
      }
      const { title, artist, album } = session.track;
      if (!title && !artist) return null;
      const key = [session.source && session.source.name, title, artist, album, JSON.stringify(session.track.genres), session.track.trackNumber, session.track.durationMs, session.playback.status].join('|');
      if (key !== global.__lastMediaKey) {
        global.__lastMediaKey = key;
        voiceLog('media meta: src=' + (session.source && session.source.name) + ' title=' + title + ' artist=' + artist + ' album=' + album + ' genres=' + JSON.stringify(session.track.genres) + ' trackNo=' + session.track.trackNumber + ' dur=' + session.track.durationMs + ' st=' + session.playback.status);
      }
      const art = await findCoverArt(artist, title || album);
      return {
        text: [title, artist].filter(Boolean).join(' — '),
        playing: session.playback.status === 'Playing',
        music: !!(album || session.track.albumArtist || (session.track.genres && session.track.genres.length)),
        dur: session.track.durationMs || null,
        art
      };
    } catch {
      return null;
    }
  });

  ipcMain.handle('get-power', async () => {
    try {
      const si = await import('systeminformation');
      const [battery, usb] = await Promise.all([
        si.battery().catch(() => null),
        si.usb().catch(() => [])
      ]);
      const kinds = { Keyboard: 'keyboard', Mouse: 'mouse', Audio: 'headphone' };
      const seen = new Set();
      const devices = (usb || [])
        .filter((u) => kinds[u.type])
        .map((u) => ({ kind: kinds[u.type], name: u.name || u.type }))
        .filter((d) => {
          const key = d.kind + '|' + d.name;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 4);
      return { battery: battery || null, devices };
    } catch {
      return { battery: null, devices: [] };
    }
  });

  ipcMain.handle('get-load', async () => {
    try {
      const si = await import('systeminformation');
      const [load, mem] = await Promise.all([
        si.currentLoad().catch(() => null),
        si.mem().catch(() => null)
      ]);
      if (Date.now() - gpuCache.ts > 10000) refreshGpu();
      return {
        cpu: load ? Math.round(load.currentLoad) : null,
        ram: mem && mem.total ? Math.round((mem.active / mem.total) * 100) : null,
        ramText: mem && mem.total ? `${(mem.active / 1073741824).toFixed(1)}/${(mem.total / 1073741824).toFixed(0)} GB` : '',
        gpu: gpuCache.data,
        gpuName: gpuCache.name || ''
      };
    } catch {
      return { cpu: null, ram: null, ramText: '', gpu: gpuCache.data, gpuName: gpuCache.name || '' };
    }
  });

  ipcMain.handle('get-ai-config', () => {
    const cfg = readAIConfig();
    return { baseUrl: cfg.baseUrl || '', apiKey: cfg.apiKey || '', model: cfg.model || '', geminiApiKey: cfg.geminiApiKey || '' };
  });

  ipcMain.handle('save-ai-config', (event, patch) => {
    const p = patch && typeof patch === 'object' ? patch : {};
    const clean = {};
    for (const k of ['baseUrl', 'apiKey', 'model', 'geminiApiKey']) {
      if (p[k] !== undefined) clean[k] = String(p[k]).slice(0, 500);
    }
    writeAIConfig(clean);
    return true;
  });

  ipcMain.handle('get-bluetooth', () => new Promise((resolve) => {
    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(app.getAppPath(), 'bluetooth.ps1')}"`,
      { timeout: 90000 },
      (err, stdout) => {
        if (err) { resolve([]); return; }
        try {
          const data = JSON.parse(stdout.trim() || '[]');
          resolve(Array.isArray(data) ? data : []);
        } catch {
          resolve([]);
        }
      }
    );
  }));

  ipcMain.handle('media-control', async (event, command) => {
    try {
      const media = await import('now-playing-media');
      if (['play', 'pause', 'toggle', 'next', 'previous'].includes(command)) {
        await media[command]();
      }
    } catch {
      // no active media session
    }
  });

  // ---------- Zapret ----------

async function zapretOnCommand() {
  const custom = readSettings().zapretBat;
  if (custom && fs.existsSync(custom)) {
    return { command: `call "${custom}"`, cwd: path.dirname(custom) };
  }
  const svcBin = await zapretServiceBinPath();
  if (svcBin) return { command: 'net start zapret', cwd: ZAPRET_DIR };
  const bats = await findZapretBat();
  if (bats.length) return { command: `call "${bats[0]}"`, cwd: path.dirname(bats[0]) };
  return null;
}

async function startZapret() {
  const t = await zapretOnCommand();
  if (!t) { zapretLog('zapret start: not found'); return false; }
  zapretLog('zapret start cmd=' + t.command);
  if (await isElevated()) { runHidden(t.command, t.cwd); return true; }
  return elevate(t.command);
}

  ipcMain.handle('zapret-status', () => isZapretRunning());

  // ---------- История буфера обмена (5 последних текстов) ----------
  const clipHistory = (readSettings().clipHistory || []).filter((x) => typeof x === 'string').slice(0, 5);
  let clipLast = '';
  let clipSaveTimer = null;
  function clipChanged() {
    clearTimeout(clipSaveTimer);
    clipSaveTimer = setTimeout(() => writeSettings({ clipHistory: clipHistory.slice() }), 800);
  }
  setInterval(() => {
    try {
      const t = clipboard.readText();
      if (!t || t === clipLast) return;
      clipLast = t;
      const idx = clipHistory.indexOf(t);
      if (idx !== -1) clipHistory.splice(idx, 1);
      clipHistory.unshift(t.slice(0, 2000));
      if (clipHistory.length > 5) clipHistory.length = 5;
      clipChanged();
    } catch {}
  }, 1200);

  ipcMain.handle('get-clipboard-history', () => clipHistory.slice());

  // ducking: постоянный powershell-процесс, команды через stdin — без спавна на каждую фразу
  let volDuckProc = null;
  function volDuck(dir) {
    if (!volDuckProc || volDuckProc.killed) {
      volDuckProc = spawn('powershell', ['-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File', path.join(app.getAppPath(), 'vol-duck-server.ps1')], { stdio: ['pipe', 'ignore', 'ignore'] });
      volDuckProc.on('exit', () => { volDuckProc = null; });
      volDuckProc.on('error', () => { volDuckProc = null; });
    }
    try { volDuckProc.stdin.write(dir + '\n'); } catch { try { volDuckProc.kill(); } catch {} volDuckProc = null; }
  }
  ipcMain.handle('vol-duck', (event, dir) => {
    volDuck(dir === 'down' ? 'down' : 'up');
    return true;
  });

  ipcMain.handle('clipboard-write', (event, text) => {
    try { clipboard.writeText(String(text == null ? '' : text).slice(0, 10000)); return true; } catch { return false; }
  });

  ipcMain.handle('get-settings', () => readSettings());

  ipcMain.handle('save-settings', (event, patch) => {
    const p = patch && typeof patch === 'object' ? patch : {};
    if (p.zapretBat !== undefined) p.zapretBat = String(p.zapretBat).slice(0, 500);
    if (p.micDeviceId !== undefined) p.micDeviceId = String(p.micDeviceId).slice(0, 200);
    return writeSettings(p);
  });

  // ---------- Автозапуск (Task Scheduler, highest privileges) ----------

  const STARTUP_TASK = 'Wiveru';

  function autostartTaskExists() {
    return new Promise((resolve) => {
      exec(`schtasks /query /tn "${STARTUP_TASK}"`, { timeout: 8000 }, (err) => resolve(!err));
    });
  }

  ipcMain.handle('get-autostart', () => autostartTaskExists());

  ipcMain.handle('set-autostart', async (event, enabled) => {
    try {
      const exe = process.execPath;
      const appPath = app.getAppPath();
      const tr = enabled
        ? `"\\"${exe}\\"${process.defaultApp ? ` \\"${appPath}\\"` : ''}"`
        : null;
      const cmd = enabled
        ? `schtasks /create /tn "${STARTUP_TASK}" /tr ${tr} /sc onlogon /rl highest /it /f`
        : `schtasks /delete /tn "${STARTUP_TASK}" /f`;
      zapretLog('autostart ' + (enabled ? 'on' : 'off') + ' cmd=' + cmd);
      if (await isElevated()) {
        runHidden(cmd);
        return true;
      }
      return elevate(cmd);
    } catch (e) {
      zapretLog('autostart error: ' + (e && e.message ? e.message : e));
      return false;
    }
  });

  ipcMain.handle('zapret-toggle', async () => {
    try {
      const running = await isZapretRunning();
      const elevated = await isElevated();
      let command = null;
      let cwd = ZAPRET_DIR;

      if (running) {
        command = ZAPRET_OFF_CMD;
      } else {
        const t = await zapretOnCommand();
        if (t) { command = t.command; cwd = t.cwd; }
      }

      if (!command) {
        zapretLog('toggle: zapret not found');
        return { ok: false, text: 'Zapret не найден на компьютере' };
      }

      zapretLog(`toggle running=${running} elevated=${elevated} cmd=${command}`);
      if (elevated) {
        runHidden(command, cwd);
        return { ok: true };
      }
      const ok = await elevate(command);
      return { ok, text: ok ? '' : 'Отменено или ошибка UAC' };
    } catch (e) {
      zapretLog('toggle error: ' + (e && e.message ? e.message : e));
      return { ok: false, text: 'Ошибка: ' + (e && e.message ? e.message : e) };
    }
  });

  // ---------- AI ----------

  function useCloudAI() {
    const cfg = readAIConfig();
    return cfg.geminiApiKey || (cfg.baseUrl && (cfg.apiKey || cfg.model));
  }

  // прогрев локальной модели в фоне — фолбэк Pollinations не должен грузиться 15с
  setTimeout(() => { ensureAI().catch(() => {}); }, 20000);

  // авто-выгрузка ИИ после 15 мин простоя + лог памяти раз в минуту
  let lastAIUse = Date.now();
  const origEnsure = ensureAI;
  ensureAI = async function () { lastAIUse = Date.now(); return origEnsure(); };
  setInterval(async () => {
    if (aiSession && Date.now() - lastAIUse > 15 * 60 * 1000) {
      zapretLog('ai idle unload');
      await unloadAI();
    }
    const m = process.memoryUsage();
    zapretLog('mem rss=' + Math.round(m.rss / 1048576) + 'MB heap=' + Math.round(m.heapUsed / 1048576) + 'MB');
  }, 60000);

  ipcMain.handle('ai-warm', async () => {
    if (useCloudAI()) { sendAIStatus('ready'); return true; }
    try { await ensureAI(); return true; } catch { return false; }
  });

  async function localAIAnswer(question) {
    try {
      const session = await ensureAI();
      const stripThink = (s) => String(s).replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
      let promptText = question + '\n/no_think';
      for (let i = 0; i < 3; i++) {
        const raw = await session.prompt(promptText);
        const cleaned = stripThink(raw);
        const m = cleaned.match(/^\s*SEARCH:\s*(.+)$/im);
        if (m && i < 2) {
          const query = m[1].trim().slice(0, 300);
          const results = await webSearch(query);
          if (results.length) {
            const ctx = results.map((r, j) => `[${j + 1}] ${r.title}: ${r.snippet}`).join('\n');
            promptText = `Результаты поиска в интернете по запросу «${query}». Используй их для точного ответа:\n${ctx}\n\nТеперь ответь на исходный вопрос: ${question}\n/no_think`;
          } else {
            promptText = `По запросу «${query}» поиск ничего не дал. Ответь на вопрос как можешь: ${question}\n/no_think`;
          }
          continue;
        }
        return { ok: true, text: cleaned || String(raw) };
      }
      return { ok: true, text: 'Не удалось получить ответ.' };
    } catch (e) {
      return { ok: false, text: 'Ошибка ИИ: ' + (e && e.message ? e.message : e) };
    }
  }

  let cloudFailUntil = 0;

  ipcMain.handle('ai-chat', async (event, text) => {
    const question = String(text).slice(0, 2000);
    const cfg = readAIConfig();
    if (cfg.baseUrl && (cfg.apiKey || cfg.model) && Date.now() >= cloudFailUntil) {
      try {
        const answer = await openAICompatAnswer(cfg, question);
        return { ok: true, text: answer || 'Пустой ответ.' };
      } catch (e) {
        cloudFailUntil = Date.now() + 60000;
        zapretLog('cloud ai fail, fallback local: ' + (e && e.message ? e.message : e));
        const local = await localAIAnswer(question);
        if (local.ok) return local;
        return { ok: false, text: 'Ошибка API: ' + (e && e.message ? e.message : e) + ' | локально: ' + local.text };
      }
    }
    if (cfg.baseUrl && (cfg.apiKey || cfg.model)) {
      zapretLog('cloud ai cooldown, straight to local');
    }
    if (cfg.geminiApiKey) {
      try {
        const answer = await geminiChat(cfg.geminiApiKey, question);
        return { ok: true, text: answer || 'Пустой ответ.' };
      } catch (e) {
        zapretLog('gemini fail, fallback local: ' + (e && e.message ? e.message : e));
        const local = await localAIAnswer(question);
        if (local.ok) return local;
        return { ok: false, text: 'Ошибка Gemini: ' + (e && e.message ? e.message : e) };
      }
    }
    return localAIAnswer(question);
  });

  ipcMain.handle('translate', async (event, payload) => {
    const text = String((payload && payload.text) || '').slice(0, 1500);
    const lang = String((payload && payload.lang) || 'en').replace(/[^a-zA-Z-]/g, '');
    const src = String((payload && payload.src) || 'Autodetect').replace(/[^a-zA-Z-]/g, '');
    if (!text) return { ok: false, error: 'empty' };
    const https = require('https');
    const tryPair = (pair) => new Promise((resolve) => {
      const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + pair;
      const req = https.get(url, { timeout: 10000 }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(); });
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            const t = j && j.responseData && j.responseData.translatedText;
            resolve(t ? { ok: true, text: t } : { ok: false, error: 'bad response' });
          } catch { resolve({ ok: false, error: 'parse' }); }
        });
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.on('error', () => resolve({ ok: false, error: 'network' }));
    });
    let r = await tryPair(src + '|' + lang);
    if (!r.ok) r = await tryPair('Autodetect|' + lang);
    if (!r.ok) r = await tryPair('ru|' + lang);
    return r;
  });

  ipcMain.handle('ai-unload', async () => {
    await unloadAI();
    return true;
  });

  // ---------- Voice ----------

  ipcMain.on('voice-log', (event, msg) => {
    zapretLog('voice: ' + String(msg).slice(0, 300));
  });

  ipcMain.handle('transcribe-pcm', async (event, payload) => {
    try {
      let samples;
      const d = payload && payload.data;
      if (d instanceof Float32Array) samples = d;
      else if (d instanceof ArrayBuffer) samples = new Float32Array(d);
      else if (d && d.buffer instanceof ArrayBuffer) samples = new Float32Array(d.buffer, d.byteOffset || 0, d.byteLength / 4);
      else throw new Error('bad-pcm');
      const text = await transcribePcmGiga(samples);
      return { ok: true, text };
    } catch (e) {
      return { ok: false, text: '', error: e && e.message ? e.message : String(e) };
    }
  });

  ipcMain.handle('transcribe-audio', async (event, payload) => {
    try {
      let text;
      try {
        text = await transcribeAudioLocal(payload && payload.data, payload && payload.mime);
      } catch (e) {
        voiceLog('local stt fail: ' + (e && e.message ? e.message : e));
        text = await transcribeAudio(payload && payload.data, payload && payload.mime);
      }
      return { ok: true, text };
    } catch (e) {
      return { ok: false, text: '', error: e && e.message ? e.message : String(e) };
    }
  });

  ipcMain.handle('open-discord', async () => {
    try {
      if (!(await isZapretRunning())) {
        zapretLog('open-discord: zapret off, starting first');
        const ok = await startZapret();
        if (!ok) return { ok: false, stage: 'zapret' };
        for (let i = 0; i < 24; i++) {
          await new Promise((r) => setTimeout(r, 500));
          if (await isZapretRunning()) break;
        }
      }
      const update = path.join(os.homedir(), 'AppData', 'Local', 'Discord', 'Update.exe');
      if (fs.existsSync(update)) {
        spawn(update, ['--processStart', 'Discord.exe'],
          { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        return { ok: true };
      }
      const ps = `$ErrorActionPreference='Stop'; ` +
        `try { Start-Process -FilePath 'discord'; exit 0 } catch {}; ` +
        `try { $a = Get-StartApps | Where-Object { $_.Name -like '*discord*' } | Select-Object -First 1; ` +
        `if ($a) { Start-Process ('shell:AppsFolder\\' + $a.AppID); exit 0 } } catch {}; exit 1`;
      return await new Promise((resolve) => {
        try {
          const pr = spawn('powershell.exe',
            ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps],
            { windowsHide: true });
          const timer = setTimeout(() => { try { pr.kill(); } catch {} resolve({ ok: false }); }, 15000);
          pr.on('error', () => { clearTimeout(timer); resolve({ ok: false }); });
          pr.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0 }); });
        } catch { resolve({ ok: false }); }
      });
    } catch (e) {
      zapretLog('open-discord error: ' + (e && e.message ? e.message : e));
      return { ok: false };
    }
  });

  ipcMain.handle('sys-open', (event, payload) => {
    const type = payload && payload.type;
    const v = String((payload && payload.value) || '').trim().slice(0, 300);
    if (!v) return Promise.resolve(false);
    let ps;
    if (type === 'url') {
      if (!/^https?:\/\/[^\s'"<>]+$/i.test(v)) return Promise.resolve(false);
      ps = `Start-Process -FilePath '${v.replace(/'/g, "''")}'`;
    } else {
      const e = v.replace(/'/g, "''");
      ps = `$ErrorActionPreference='Stop'; ` +
        `try { Start-Process -FilePath '${e}'; exit 0 } catch {}; ` +
        `try { $a = Get-StartApps | Where-Object { $_.Name -like '*${e}*' } | Select-Object -First 1; ` +
        `if ($a) { Start-Process ('shell:AppsFolder\\' + $a.AppID); exit 0 } } catch {}; exit 1`;
    }
    return new Promise((resolve) => {
      try {
        const p = spawn('powershell.exe',
          ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps],
          { windowsHide: true });
        const timer = setTimeout(() => { try { p.kill(); } catch {} resolve(false); }, 15000);
        p.on('error', () => { clearTimeout(timer); resolve(false); });
        p.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
      } catch { resolve(false); }
    });
  });

  ipcMain.handle('sys-close', (event, name) => {
    const e = String(name || '').trim().slice(0, 100).replace(/'/g, "''");
    if (!e) return false;
    try {
      spawn('powershell.exe',
        ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
         `Get-Process | Where-Object { $_.ProcessName -like '*${e}*' } | Stop-Process -Force -ErrorAction SilentlyContinue`],
        { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
      return true;
    } catch { return false; }
  });

  ipcMain.handle('sys-shutdown', (event, mode) => {
    try {
      if (mode === 'smart') {
        const ps = 'Get-Process chrome,msedge,firefox,brave,opera,yandex,vivaldi,chromium,safari -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }; Start-Sleep -Seconds 4; shutdown /s /t 45';
        spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps],
          { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
        return true;
      }
      const args = mode === 'abort' ? ['/a'] : ['/s', '/t', '60'];
      spawn('shutdown.exe', args, { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
      return true;
    } catch { return false; }
  });

  ipcMain.handle('system-key', (event, key) => {
    const codes = { 'volume-up': 175, 'volume-down': 174, 'volume-mute': 173 };
    const code = codes[key];
    if (!code) return false;
    try {
      spawn('powershell.exe',
        ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
         `(New-Object -ComObject WScript.Shell).SendKeys([char]${code})`],
        { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
      return true;
    } catch { return false; }
  });

  ipcMain.handle('show-window', () => {
    if (win) { win.show(); win.focus(); }
    return true;
  });

  ipcMain.handle('hide-window', () => {
    if (win) win.hide();
  });

  createWindow();
  createTray();

  let lastVis = null;
  setInterval(() => {
    const v = win && !win.isDestroyed() ? win.isVisible() : null;
    if (v !== lastVis) {
      lastVis = v;
      zapretLog('window visible=' + v);
    }
  }, 1000);

  const toggle = () => {
    if (win.isVisible()) win.hide();
    else win.show();
  };
  globalShortcut.register('CommandOrControl+Alt+I', toggle);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
