const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { execFile, spawn } = require('child_process');

const isDev = !app.isPackaged;
// распакованный запуск: repo/installer -> repo; exe в корне репо -> его папка
const TARGET = isDev ? path.resolve(__dirname, '..') : path.dirname(process.execPath);
const GIGA_DIR = 'sherpa-onnx-nemo-ctc-punct-giga-am-v3-russian-2025-12-16';
const GIGA_BASE = 'https://huggingface.co/csukuangfj/' + GIGA_DIR + '/resolve/main/';

let win = null;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const log = (msg) => send('log', msg);

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: TARGET, shell: false, windowsHide: true, ...opts });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => resolve({ code: 1, out: out + '\n' + (e && e.message || e) }));
    p.on('close', (code) => resolve({ code: code || 0, out }));
  });
}

function which(exe) {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'where' : 'which';
    execFile(shell, [exe], (err) => resolve(!err));
  });
}

function runVer(cmd) {
  return new Promise((resolve) => {
    execFile(cmd, ['--version'], { timeout: 8000 }, (err, stdout) => resolve(!err && /\d/.test(stdout || '')));
  });
}

function findFile(dir, names) {
  try {
    for (const n of names) {
      const p = path.join(dir, n);
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return null;
}

function globDirs(base, pattern) {
  try {
    return fs.readdirSync(base).filter((d) => d.startsWith(pattern)).map((d) => path.join(base, d));
  } catch { return []; }
}

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https : http;
    const doGet = (u, redirects = 0) => {
      const req = get.get(u, { timeout: 30000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
          res.resume();
          return doGet(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let got = 0;
        const ws = fs.createWriteStream(dest);
        res.on('data', (c) => {
          got += c.length;
          if (total) onProgress(got / total);
          ws.write(c);
        });
        res.on('end', () => ws.end());
        ws.on('finish', () => resolve());
        ws.on('error', reject);
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.on('error', reject);
    };
    doGet(url);
  });
}

async function step(name, fn) {
  log('▶ ' + name);
  send('step', name);
  const r = await fn();
  if (r === false) throw new Error('step failed: ' + name);
  log('✔ ' + name);
  return true;
}

async function runSetup(opts = {}) {
  try {
    // 1. env — ищем и в PATH, и в стандартных папках установки
    const extraPath = [];
    let hasNode = await which('node');
    let nodeDir = null;
    if (!hasNode) {
      const candidates = [
        'C:\\Program Files\\nodejs',
        process.env['ProgramFiles'] && path.join(process.env['ProgramFiles'], 'nodejs'),
        process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'nodejs'),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs')
      ].filter(Boolean);
      for (const d of candidates) {
        if (findFile(d, ['node.exe'])) { nodeDir = d; hasNode = true; break; }
      }
    }
    if (hasNode && !nodeDir) {
      // node в PATH — npm обычно рядом, но проверим
      nodeDir = null;
    }
    if (nodeDir) extraPath.push(nodeDir);

    let hasNpm = await which('npm');
    if (!hasNpm && nodeDir && findFile(nodeDir, ['npm.cmd'])) hasNpm = true;

    // python: where может найти заглушку Microsoft Store — проверяем реальный запуск
    let pyExe = null;
    for (const c of ['python', 'py']) {
      if (await which(c) && await runVer(c)) { pyExe = c; break; }
    }
    let pyDir = null;
    if (!pyExe) {
      const bases = [
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Python'),
        'C:\\Python3', 'C:\\Python314', 'C:\\Python313', 'C:\\Python312', 'C:\\Python311', 'C:\\Python310'
      ].filter(Boolean);
      const dirs = [];
      for (const b of bases) {
        try { if (fs.statSync(b).isDirectory()) dirs.push(b); } catch {}
        dirs.push(...globDirs(b, 'Python3'));
      }
      for (const d of dirs) {
        const p = findFile(d, ['python.exe']);
        if (p && await runVer(p)) { pyExe = p; pyDir = d; break; }
      }
    }
    const hasPy = !!pyExe;
    if (pyDir) extraPath.push(pyDir);

    if (!hasNode || !hasNpm || !hasPy) {
      log('✖ Не найдено: ' + [!hasNode && 'Node.js', !hasNpm && 'npm', !hasPy && 'Python'].filter(Boolean).join(', '));
      log('  Node.js: https://nodejs.org/  (при установке оставь галочку PATH)');
      log('  Python: https://www.python.org/downloads/  (галочка Add python.exe to PATH)');
      send('done', { ok: false });
      return;
    }
    if (extraPath.length) {
      process.env.PATH = extraPath.join(';') + ';' + process.env.PATH;
      log('✔ Node.js, npm и Python найдены' + (extraPath.length ? ' (в стандартных папках, добавлены в PATH)' : ''));
    } else {
      log('✔ Node.js, npm и Python найдены');
    }

    // 2. npm install
    await step('npm install', async () => {
      send('progress', { step: 'npm install', pct: -1 });
      const r = await run('npm', ['install'], { shell: true });
      if (r.code !== 0) { log(r.out.slice(-2000)); return false; }
      return true;
    });

    // 3. models dir + gigaam
    const gdir = path.join(TARGET, 'models', 'gigaam', GIGA_DIR);
    fs.mkdirSync(gdir, { recursive: true });
    const modelPath = path.join(gdir, 'model.int8.onnx');
    const tokensPath = path.join(gdir, 'tokens.txt');
    if (fs.existsSync(modelPath) && fs.existsSync(tokensPath)) {
      log('✔ GigaAM уже скачана');
    } else {
      await step('Скачивание GigaAM STT (~225 МБ)', async () => {
        for (const [file, url] of [['model.int8.onnx', GIGA_BASE + 'model.int8.onnx'], ['tokens.txt', GIGA_BASE + 'tokens.txt']]) {
          const dest = path.join(gdir, file);
          if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) continue;
          send('progress', { step: 'GigaAM ' + file, pct: 0 });
          try {
            await download(url, dest, (f) => send('progress', { step: 'GigaAM ' + file, pct: Math.round(f * 100) }));
          } catch (e) {
            log('  ошибка скачивания ' + file + ': ' + e.message);
            try { fs.unlinkSync(dest); } catch {}
            return false;
          }
        }
        return true;
      });
    }

    // 4. venv + sherpa-onnx
    const venvPy = path.join(TARGET, 'stt-venv', 'Scripts', 'python.exe');
    await step('Python venv + sherpa-onnx', async () => {
      if (!fs.existsSync(venvPy)) {
        const py = pyExe || 'python';
        const r = await run(py, ['-m', 'venv', 'stt-venv']);
        if (r.code !== 0) { log(r.out.slice(-1000)); return false; }
      }
      const r = await run(venvPy, ['-m', 'pip', 'install', 'sherpa-onnx'], {});
      if (r.code !== 0) { log(r.out.slice(-1500)); return false; }
      return true;
    });

    // 5. configs
    await step('Конфиги', async () => {
      for (const [ex, dst] of [['ai-config.example.json', 'ai-config.json'], ['settings.example.json', 'settings.json']]) {
        const s = path.join(TARGET, ex), d = path.join(TARGET, dst);
        if (!fs.existsSync(d) && fs.existsSync(s)) fs.copyFileSync(s, d);
      }
      return true;
    });

    // 6. optional GGUF
    const hasGguf = fs.readdirSync(path.join(TARGET, 'models')).some((f) => f.toLowerCase().endsWith('.gguf'));
    if (opts.gguf && !hasGguf) {
      await step('Скачивание Qwen3-4B (~2.5 ГБ)', async () => {
        const dest = path.join(TARGET, 'models', 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf');
        send('progress', { step: 'Qwen3-4B GGUF', pct: 0 });
        try {
          await download('https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf', dest,
            (f) => send('progress', { step: 'Qwen3-4B GGUF', pct: Math.round(f * 100) }));
          return true;
        } catch (e) {
          log('  ошибка GGUF (не критично): ' + e.message);
          try { fs.unlinkSync(dest); } catch {}
          return true; // не фейлим установку
        }
      });
    } else if (opts.gguf) {
      log('✔ GGUF-модель уже есть');
    }

    log('============================================');
    log('Установка завершена! Запустите Wiveru.');
    send('done', { ok: true });
  } catch (e) {
    log('✖ ' + (e && e.message ? e.message : e));
    send('done', { ok: false });
  }
}

ipcMain.handle('start-setup', async (e, opts) => { runSetup(opts || {}); return true; });

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 480,
    height: 600,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#08070d',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
});

app.on('window-all-closed', () => app.quit());
