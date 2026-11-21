const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { execFile, spawn } = require('child_process');
const os = require('os');

const isDev = !app.isPackaged;
// распакованный запуск: repo/installer -> repo; exe в корне репо -> его папка
let TARGET = isDev ? path.resolve(__dirname, '..') : path.dirname(process.execPath);
const GIGA_DIR = 'sherpa-onnx-nemo-ctc-punct-giga-am-v3-russian-2025-12-16';
const GIGA_BASE = 'https://huggingface.co/csukuangfj/' + GIGA_DIR + '/resolve/main/';
const RUNTIME = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Wiveru', 'runtime');
const NODE_ZIP_URL = 'https://nodejs.org/dist/v26.13.1/node-v26.13.1-win-x64.zip';
const NODE_DIRNAME = 'node-v26.13.1-win-x64';
const GIT_SFX_URL = 'https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/PortableGit-2.56.1-64-bit.7z.exe';
const PY_URL = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe';
const REPO_ZIP = 'https://github.com/w1veru/Wiveru/archive/refs/heads/master.zip';
const APP_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Programs', 'Wiveru');

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

function appReady(dir) {
  return fs.existsSync(path.join(dir, 'stt_server.py')) && fs.existsSync(path.join(dir, 'package.json'));
}

async function ensureAppDir() {
  if (appReady(TARGET)) return;
  await step('Загрузка Wiveru', async () => {
    if (!appReady(APP_DIR)) {
      const tmp = path.join(os.tmpdir(), 'wiveru-repo.zip');
      const exDir = path.join(os.tmpdir(), 'wiveru-extract');
      send('progress', { step: 'Wiveru repo', pct: 0 });
      try {
        await download(REPO_ZIP, tmp, (f) => send('progress', { step: 'Wiveru repo', pct: Math.round(f * 100) }));
        fs.mkdirSync(exDir, { recursive: true });
        const ex = await run('tar.exe', ['-xf', tmp, '-C', exDir]);
        try { fs.unlinkSync(tmp); } catch {}
        if (ex.code !== 0) { log('  ошибка распаковки: ' + (ex.out || '').slice(-300)); return false; }
        const src = path.join(exDir, 'Wiveru-master');
        fs.mkdirSync(path.dirname(APP_DIR), { recursive: true });
        if (fs.existsSync(APP_DIR)) fs.rmSync(APP_DIR, { recursive: true, force: true });
        try {
          fs.renameSync(src, APP_DIR);
        } catch {
          fs.cpSync(src, APP_DIR, { recursive: true });
        }
        fs.rmSync(exDir, { recursive: true, force: true });
        if (!appReady(APP_DIR)) { log('  не найден распакованный проект'); return false; }
      } catch (e) {
        log('  ошибка загрузки: ' + e.message);
        return false;
      }
    }
    TARGET = APP_DIR;
    log('  проект: ' + TARGET);
    return true;
  });
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
    // 0. если exe запущен не из папки проекта — скачать репозиторий в %LOCALAPPDATA%\Programs\Wiveru
    await ensureAppDir();

    // 1. env — ищем и в PATH, и в стандартных папках; Node/Python можно доустановить сами
    const extraPath = [];
    let hasNode = await which('node');
    let nodeDir = null;

    // авто-установка Node.js portable zip, если не найден нигде
    if (!hasNode) {
      const r = await step('Установка Node.js', async () => {
        const dir = path.join(RUNTIME, 'node');
        const marker = path.join(dir, NODE_DIRNAME, 'node.exe');
        if (!fs.existsSync(marker)) {
          fs.mkdirSync(dir, { recursive: true });
          const tmp = path.join(os.tmpdir(), 'wiveru-node.zip');
          send('progress', { step: 'Node.js zip', pct: 0 });
          try {
            await download(NODE_ZIP_URL, tmp, (f) => send('progress', { step: 'Node.js zip', pct: Math.round(f * 100) }));
            const ex = await run('tar.exe', ['-xf', tmp, '-C', dir]);
            try { fs.unlinkSync(tmp); } catch {}
            if (ex.code !== 0 || !fs.existsSync(marker)) { log('  ошибка распаковки node'); return false; }
          } catch (e) {
            log('  ошибка скачивания Node.js: ' + e.message);
            return false;
          }
        }
        process.env.PATH = path.join(dir, NODE_DIRNAME) + ';' + process.env.PATH;
        return fs.existsSync(marker);
      });
      if (r) {
        hasNode = true;
        nodeDir = path.join(RUNTIME, 'node', NODE_DIRNAME);
      }
    }
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
    async function detectPython() {
      for (const c of ['python', 'py']) {
        if (await which(c) && await runVer(c)) return { exe: c, dir: null };
      }
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
        if (p && await runVer(p)) return { exe: p, dir: d };
      }
      return null;
    }

    let py = await detectPython();
    if (!py) {
      await step('Установка Python 3.12', async () => {
        const tmp = path.join(os.tmpdir(), 'wiveru-python.exe');
        send('progress', { step: 'Python installer', pct: 0 });
        try {
          await download(PY_URL, tmp, (f) => send('progress', { step: 'Python installer', pct: Math.round(f * 100) }));
          const r = await run(tmp, ['/quiet', 'InstallAllUsers=0', 'PrependPath=0', 'Include_pip=1', 'Include_test=0', 'AssociateFiles=0']);
          try { fs.unlinkSync(tmp); } catch {}
          if (r.code !== 0) log('  установщик вернул код ' + r.code + ' (продолжаем)');
        } catch (e) {
          log('  ошибка Python: ' + e.message);
          return false;
        }
        return true;
      });
      py = await detectPython();
    }
    const pyExe = py && py.exe;
    const hasPy = !!pyExe;
    if (py && py.dir && !extraPath.includes(py.dir)) extraPath.push(py.dir);

    if (!hasNode || !hasNpm || !hasPy) {
      log('✖ Не найдено: ' + [!hasNode && 'Node.js', !hasNpm && 'npm', !hasPy && 'Python'].filter(Boolean).join(', '));
      log('  авто-установка не удалась. Вручную:');
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
          await download('https://huggingface.co/lmstudio-community/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf', dest,
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

    // 7. Git (опционально, не блокирует установку)
    const hasGit = await which('git');
    if (!hasGit) {
      await step('Установка Git (опционально)', async () => {
        const dir = path.join(RUNTIME, 'git');
        const marker = path.join(dir, 'cmd', 'git.exe');
        if (!fs.existsSync(marker)) {
          fs.mkdirSync(dir, { recursive: true });
          const tmp = path.join(os.tmpdir(), 'wiveru-git.exe');
          send('progress', { step: 'Git', pct: 0 });
          try {
            await download(GIT_SFX_URL, tmp, (f) => send('progress', { step: 'Git', pct: Math.round(f * 100) }));
            // PortableGit — self-extracting 7z: тихая распаковка в dir
            const ex = await run(tmp, ['-o' + dir, '-y']);
            try { fs.unlinkSync(tmp); } catch {}
            if (!fs.existsSync(marker)) { log('  Git не распаковался: ' + (ex.out || '').slice(-300)); return true; }
          } catch (e) {
            log('  ошибка Git (не критично): ' + e.message);
            return true;
          }
        }
        process.env.PATH = path.join(dir, 'cmd') + ';' + process.env.PATH;
        log('✔ Git установлен в ' + dir);
        return true;
      });
    } else {
      log('✔ Git уже есть');
    }

    // 8. ярлык на рабочем столе — запуск через electron.exe, консоль не нужна
    await step('Ярлык Wiveru', async () => {
      const electronExe = path.join(TARGET, 'node_modules', 'electron', 'dist', 'electron.exe');
      if (!fs.existsSync(electronExe)) { log('  electron.exe не найден, ярлык пропущен'); return true; }
      const ps = [
        '$d = [Environment]::GetFolderPath("Desktop");',
        '$ws = New-Object -ComObject WScript.Shell;',
        '$s = $ws.CreateShortcut((Join-Path $d "Wiveru.lnk"));',
        '$s.TargetPath = ' + JSON.stringify(electronExe) + ';',
        '$s.Arguments = ' + JSON.stringify('"' + TARGET + '"') + ';',
        '$s.WorkingDirectory = ' + JSON.stringify(TARGET) + ';',
        '$s.Description = "Wiveru — голосовой ассистент";',
        '$s.Save()'
      ].join(' ');
      const r = await run('powershell.exe', ['-NoProfile', '-Command', ps]);
      if (r.code !== 0) { log('  не удалось создать ярлык: ' + (r.out || '').slice(-300)); return true; }
      log('  ярлык создан на рабочем столе');
      return true;
    });

    log('============================================');
    log('Установка завершена! Wiveru — на рабочем столе.');
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
