const { ipcRenderer } = require('electron');

function init() {
  const island = document.getElementById('island');
  const mediaTitle = document.querySelector('.media-title');
  const playPauseBtn = document.getElementById('play-pause');
  const compactTime = document.getElementById('compact-time');
  const bigTime = document.getElementById('big-time');
  const uptimeEl = document.getElementById('uptime');

  function formatTime(date) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function updateTime() {
    const t = formatTime(new Date());
    compactTime.textContent = t;
    bigTime.textContent = t;
  }

  function updateUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    uptimeEl.textContent = d > 0
      ? `ПК работает: ${d} д ${h} ч ${m} мин`
      : `ПК работает: ${h} ч ${m} мин`;
  }

  setInterval(updateTime, 1000);
  updateTime();

  ipcRenderer.invoke('get-uptime').then(updateUptime);
  setInterval(() => ipcRenderer.invoke('get-uptime').then(updateUptime), 30000);

  function updateMedia() {
    ipcRenderer.invoke('get-media').then((info) => {
      mediaTitle.textContent = info ? info.text : 'Нет трека';
      playPauseBtn.textContent = info && info.playing ? '❚❚' : '▶';
    });
  }

  updateMedia();
  setInterval(updateMedia, 5000);

  document.querySelectorAll('.media-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      ipcRenderer.invoke('media-control', btn.dataset.cmd);
      setTimeout(updateMedia, 400);
    });
  });



}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
