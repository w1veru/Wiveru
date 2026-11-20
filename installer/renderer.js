const { ipcRenderer } = require('electron');

const logEl = document.getElementById('log');
const fill = document.getElementById('progress-fill');
const label = document.getElementById('progress-label');
const startBtn = document.getElementById('start-btn');
const closeBtn = document.getElementById('close-btn');

let running = false;
const STEPS = 5;
let done = 0;

function addLog(msg) {
  const div = document.createElement('div');
  if (msg.startsWith('✔')) div.className = 'ok';
  else if (msg.startsWith('✖')) div.className = 'err';
  div.textContent = msg;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

ipcRenderer.on('log', (e, msg) => addLog(msg));
ipcRenderer.on('progress', (e, p) => {
  if (p.pct >= 0) {
    fill.style.width = p.pct + '%';
    label.textContent = p.step + ' — ' + p.pct + '%';
  } else {
    label.textContent = p.step + '…';
  }
});
ipcRenderer.on('step', (e, name) => {
  done++;
  fill.style.width = Math.round((done / STEPS) * 100) + '%';
  label.textContent = name;
});
ipcRenderer.on('done', (e, r) => {
  running = false;
  startBtn.disabled = false;
  startBtn.textContent = r.ok ? 'Готово ✓' : 'Повторить';
  fill.style.width = r.ok ? '100%' : fill.style.width;
  label.textContent = r.ok ? 'Установка завершена!' : 'Ошибка — см. лог';
  if (r.ok) setTimeout(() => { try { window.close(); } catch {} }, 2500);
});

startBtn.addEventListener('click', () => {
  if (running) return;
  running = true;
  startBtn.disabled = true;
  startBtn.textContent = 'Установка…';
  logEl.innerHTML = '';
  done = 0;
  fill.style.width = '0%';
  ipcRenderer.invoke('start-setup');
});

closeBtn.addEventListener('click', () => window.close());
