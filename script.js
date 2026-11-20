const { ipcRenderer } = require('electron');

function voiceLog(msg) {
  try { ipcRenderer.send('voice-log', String(msg)); } catch {}
}

function init() {
  const island = document.getElementById('island');
  let mouseGuard = false;
  function updateHoverGuard(x, y) {
    const r = island.getBoundingClientRect();
    const on = x >= r.left - 14 && x <= r.right + 14 && y >= r.top - 1 && y <= r.bottom + 40;
    island.classList.toggle('hover-open', on);
    if (on !== mouseGuard) {
      mouseGuard = on;
      ipcRenderer.send('mouse-guard', on);
    }
  }
  window.addEventListener('mousemove', (e) => updateHoverGuard(e.clientX, e.clientY));
  ipcRenderer.on('cursor-pos', (e, pos) => updateHoverGuard(pos.x, pos.y));
  document.addEventListener('mouseleave', () => {
    island.classList.remove('hover-open');
    if (mouseGuard) { mouseGuard = false; ipcRenderer.send('mouse-guard', false); }
  });
  const mediaArt = document.getElementById('media-art');
  const mediaArtPh = document.getElementById('media-art-ph');
  const mediaTitleClip = document.getElementById('media-title-clip');
  const mediaTitleTrack = document.getElementById('media-title-track');
  const mediaTitleA = document.getElementById('media-title-a');
  const islandWave = document.getElementById('island-wave');
  const mediaTitleB = document.getElementById('media-title-b');
  const playPauseBtn = document.getElementById('play-pause');
  const compactTime = document.getElementById('compact-time');
  const bigTime = document.getElementById('big-time');
  const clockSub = document.getElementById('clock-sub');
  const uptimeEl = document.getElementById('uptime');
  const batteryInfo = document.getElementById('battery-info');
  const deviceInfo = document.getElementById('device-info');
  const zapretBtn = document.getElementById('zapret-btn');
  const zapretStatus = document.getElementById('zapret-status');
  const aiBtn = document.getElementById('ai-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const zapretPathInput = document.getElementById('zapret-path');
  const zapretSaveBtn = document.getElementById('zapret-save');
  const settingsCloseBtn = document.getElementById('settings-close');
  const setStatus = document.getElementById('set-status');
  const autostartCheck = document.getElementById('autostart-check');
  const waveCheck = document.getElementById('wave-check');
  const chatPanel = document.getElementById('chat-panel');
  const chatLog = document.getElementById('chat-log');
  const chatStatus = document.getElementById('chat-status');
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');
  const chatClear = document.getElementById('chat-clear');
  const loadBtn = document.getElementById('load-btn');
  const clipBtn = document.getElementById('clip-btn');
  const translateBtn = document.getElementById('translate-btn');
  const clipList = document.getElementById('clip-list');
  const loadCpuFill = document.getElementById('load-cpu-fill');
  const loadGpuFill = document.getElementById('load-gpu-fill');
  const loadRamFill = document.getElementById('load-ram-fill');
  const loadCpuVal = document.getElementById('load-cpu-val');
  const loadGpuVal = document.getElementById('load-gpu-val');
  const loadRamVal = document.getElementById('load-ram-val');
  const loadGpuInfo = document.getElementById('load-gpu-info');
  const voiceCheck = document.getElementById('voice-check');
  const micSelect = document.getElementById('mic-select');
  const aiBaseInput = document.getElementById('ai-base');
  const aiKeyInput = document.getElementById('ai-key');
  const aiModelInput = document.getElementById('ai-model');

  const DEVICE_ICONS = { mouse: '🖱️', keyboard: '⌨️', headphone: '🎧', other: '🔵' };
  const KIND_ORDER = ['mouse', 'keyboard', 'headphone', 'other'];

  function classifyDevice(name) {
    const n = (name || '').toLowerCase();
    if (/mouse|мыш|logitech|mx |g pro|m185|m720|m585|trackball/.test(n)) return 'mouse';
    if (/keyboard|клавиат|keychron|logi k|k3|max|k380|k120/.test(n)) return 'keyboard';
    if (/headphone|headset|наушник|airpods|buds|earbud|earphone|sony|jbl|bose|beats|soundcore|audio|hands-free|speaker|liberty|echo|momentum|qc/.test(n)) return 'headphone';
    return 'other';
  }

  function formatTime(date) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function updateTime() {
    const d = new Date();
    const t = formatTime(d);
    compactTime.textContent = t;
    bigTime.textContent = t;
    const date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
    const sec = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (clockSub) clockSub.textContent = date + ' · ' + sec;
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

  // ---------- Басовая волна под островом ----------
  let waveEnabled = true, waveDbgTs = 0, waveLastTs = 0, waveStream = null, waveTried = false, waveCtx = null, waveAn = null, waveData = null, waveRAF = 0, bassLevel = 0;
  let mediaActiveFlag = false, mediaKind = 'idle', probeFrames = 0, probeBass = 0, probeMid = 0, probeAll = 0, probeE = [], noAnFrames = 0, mediaDurBlocked = false, mediaInherited = false, lastTrackKey = null, lastMediaActive = null;
  const waveC = islandWave.getContext('2d');
  const waveDpr = Math.min(2, window.devicePixelRatio || 1);
  waveC.setTransform(waveDpr, 0, 0, waveDpr, 0, 0);

  async function ensureLoopback() {
    if (waveStream || waveTried) return waveStream;
    waveTried = true;
    try {
      const id = await ipcRenderer.invoke('desktop-source-id');
      if (!id) return null;
      waveStream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id } },
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: 2, maxHeight: 2, maxFrameRate: 1 } }
      });
      waveStream.getVideoTracks().forEach((t) => t.stop());
      waveCtx = waveCtx || new (window.AudioContext || window.webkitAudioContext)();
      const src = waveCtx.createMediaStreamSource(new MediaStream(waveStream.getAudioTracks()));
      waveAn = waveCtx.createAnalyser();
      waveAn.fftSize = 2048;
      waveAn.smoothingTimeConstant = 0.3;
      src.connect(waveAn);
      waveData = new Uint8Array(waveAn.frequencyBinCount);
      voiceLog('loopback audio ok');
    } catch (e) {
      voiceLog('loopback fail: ' + (e && e.message ? e.message : e));
      waveStream = null;
    }
    return waveStream;
  }

  const WAVE_N = 40, WAVE_H = 46;
  let waveW = 600, waveCssW = 0;
  const waveY = new Float32Array(WAVE_N + 1);
  let waveAmp = 0;
  let waveGlowPx = 5, waveGlowA = 0.22;

  function ensureWaveSize() {
    const w = Math.max(50, Math.round(islandWave.clientWidth || 600));
    if (w === waveCssW) return;
    waveCssW = w;
    waveW = w;
    islandWave.width = w * waveDpr;
    islandWave.height = WAVE_H * waveDpr;
    waveC.setTransform(waveDpr, 0, 0, waveDpr, 0, 0);
    waveY.fill(0);
  }

  function drawWave(ampTarget, dt) {
    ensureWaveSize();
    const t = performance.now() / 1000;
    waveAmp = ampTarget;
    const a = waveAmp;
    waveC.clearRect(0, 0, waveW, WAVE_H);
    waveC.beginPath();
    const pts = [];
    for (let i = 0; i <= WAVE_N; i++) {
      const u = i / WAVE_N;
      const x = u * waveW;
      // плавное затухание к краям: волна вливается в закругления острова
      let env = Math.min(u, 1 - u) / 0.48;
      env = Math.min(1, env);
      env = env * env * (3 - 2 * env);
      // максимум 4 волны-горба, позиции дрейфуют, пульсируют по очереди
      let shape = 0;
      for (let k = 0; k < 4; k++) {
        // медленный «включатель» горба: каждый появляется и исчезает в своё время
        const g = Math.sin(t * (0.21 + k * 0.07) + k * 2.7) * 0.5 + 0.5;
        const gate = 0.15 + 0.85 * (g * g * (3 - 2 * g));
        const cx = (k + 0.5) / 4 + 0.16 * Math.sin(t * (0.31 + k * 0.13) + k * 2.1);
        const w = 0.055 + 0.02 * Math.sin(t * 0.5 + k);
        const d = (u - cx) / w;
        const bump = Math.exp(-d * d);
        const pulse = Math.pow(Math.max(0, Math.sin(t * 3.4 + k * 1.9)), 0.6);
        shape += bump * pulse * gate;
      }
      const targetY = a * env * (shape * 1.3 + 0.22 * (0.6 + 0.4 * Math.sin(i * 0.7 - t * 1.4))) + a * 0.14 * env * Math.sin(i * 4.3 + t * 21 + Math.sin(i * 1.7) * 2);
      waveY[i] = (i === 0 || i === WAVE_N) ? 0 : waveY[i] + (targetY - waveY[i]) * Math.min(1, dt * 90);
      pts.push([x, Math.min(WAVE_H - 2, Math.max(0, waveY[i]))]);
    }
    waveC.moveTo(pts[0][0], 0);
    waveC.lineTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < WAVE_N; i++) {
      const p0 = pts[i === 0 ? 0 : i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2 > WAVE_N ? WAVE_N : i + 2];
      waveC.bezierCurveTo(
        p1[0] + (p2[0] - p0[0]) / 6, Math.max(0, p1[1] + (p2[1] - p0[1]) / 6),
        p2[0] - (p3[0] - p1[0]) / 6, Math.max(0, p2[1] - (p3[1] - p1[1]) / 6),
        p2[0], p2[1]
      );
    }
    waveC.lineTo(waveW, 0);
    waveC.closePath();
    waveC.fillStyle = '#08070d';
    waveC.fill();
    // обводка только по кривой волны, без прямой верхней кромки
    waveC.beginPath();
    waveC.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < WAVE_N; i++) {
      const p0 = pts[i === 0 ? 0 : i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2 > WAVE_N ? WAVE_N : i + 2];
      waveC.bezierCurveTo(
        p1[0] + (p2[0] - p0[0]) / 6, Math.max(0, p1[1] + (p2[1] - p0[1]) / 6),
        p2[0] - (p3[0] - p1[0]) / 6, Math.max(0, p2[1] - (p3[1] - p1[1]) / 6),
        p2[0], p2[1]
      );
    }
    waveC.lineJoin = 'round';
    waveC.strokeStyle = 'rgba(168,85,247,' + (waveGlowA * 0.3).toFixed(2) + ')';
    waveC.lineWidth = 3.2;
    waveC.stroke();
    waveC.strokeStyle = 'rgba(168,85,247,0.5)';
    waveC.lineWidth = 0.7;
    waveC.stroke();
  }

  function waveTick(ts) {
    waveRAF = 0;
    const dt = waveLastTs ? Math.min(0.05, (ts - waveLastTs) / 1000) : 0.016;
    waveLastTs = ts;
    const playing = waveEnabled && mediaActiveFlag;
    const isMusic = playing && mediaKind === 'music';
    island.classList.toggle('media-playing', isMusic);
    let target = 0;
    if (playing && waveAn && waveData) {
      waveAn.getByteFrequencyData(waveData);
      // чистые басы ~40-230 Гц (бины 2-10 при 48 кГц), середина вычитается
      // только саб-бас/кик ~20-140 Гц, нижние бины весят больше
      let bass = 0, wsum = 0;
      for (let i = 1; i <= 6; i++) { const w = 7 - i; bass += waveData[i] * w; wsum += w; }
      bass /= wsum;
      if (mediaKind === 'unknown' || mediaInherited) {
        let mid = 0, all = 0;
        for (let i = 1; i <= 120; i++) { all += waveData[i]; if (i >= 20 && i <= 90) mid += waveData[i]; }
        all /= 120; mid /= 71;
        probeBass += bass; probeMid += mid; probeAll += all; probeE.push(all); probeFrames++;
        if (probeFrames >= 90) {
          const n = probeFrames, m = probeAll / n;
          const mean = probeE.reduce((a, b) => a + b, 0) / n;
          const sd = Math.sqrt(probeE.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
          const cv = sd / (mean || 1);
          const bassRatio = probeBass / (probeAll || 1);
          mediaKind = (mean > 8 && probeBass / n > 25 && cv < 0.9) ? 'music' : 'other';
          mediaInherited = false;
          voiceLog('media classify: kind=' + mediaKind + ' energy=' + mean.toFixed(1) + ' cv=' + cv.toFixed(2) + ' bass=' + (probeBass / n).toFixed(1) + ' mid=' + (probeMid / n).toFixed(1) + ' bratio=' + bassRatio.toFixed(3));
        }
      }
      if (mediaKind === 'music') {
        target = Math.min(1, Math.max(0, (bass - 30) / 190));
        if (performance.now() - (waveDbgTs || 0) > 2000) { waveDbgTs = performance.now(); voiceLog('wave bass=' + bass.toFixed(1) + ' target=' + target.toFixed(2)); }
      }
    } else if (playing) {
      if (mediaKind === 'unknown' && ++noAnFrames > 180) mediaKind = 'music';
      if (mediaKind === 'music') target = 0.4 + 0.22 * Math.sin(performance.now() * 0.0011) + 0.12 * Math.sin(performance.now() * 0.0027);
    }
    if (target > bassLevel) bassLevel = target; else bassLevel += (target - bassLevel) * 0.05;
    const tNow = performance.now() / 1000;
    const breath = playing ? (0.5 + 0.5 * Math.sin(tNow * 1.4)) : 0;
    waveGlowPx = 5 + bassLevel * 26 + breath * 4;
    waveGlowA = Math.min(0.85, 0.22 + bassLevel * 0.5 + breath * 0.08);
    // свечение острова в такт басу (вместо CSS-анимации)
    island.style.animation = 'none';
    if (bassLevel > 0.02) {
      island.style.boxShadow = '0 0 ' + (8 + bassLevel * 26).toFixed(1) + 'px rgba(168,85,247,' + (0.12 + bassLevel * 0.4).toFixed(2) + '), 0 0 ' + (24 + bassLevel * 55).toFixed(1) + 'px rgba(168,85,247,' + (0.04 + bassLevel * 0.14).toFixed(2) + ')';
      island.style.borderColor = 'rgba(168,85,247,' + (0.22 + bassLevel * 0.5).toFixed(2) + ')';
    } else {
      island.style.boxShadow = '0 0 0 rgba(168,85,247,0)';
      island.style.borderColor = '';
    }
    const wantFrames = playing && mediaKind !== 'other';
    if (isMusic || bassLevel > 0.015) {
      drawWave(bassLevel * 30, dt);
      islandWave.classList.add('on');
    } else {
      islandWave.classList.remove('on');
      waveC.clearRect(0, 0, waveW, WAVE_H);
    }
    if (wantFrames) {
      waveRAF = requestAnimationFrame(waveTick);
    } else {
      bassLevel = 0;
      island.classList.remove('media-playing');
      island.style.animation = '';
      island.style.boxShadow = '';
      island.style.borderColor = '';
    }
  }

  function startWave() {
    ensureLoopback();
    if (!waveRAF) waveRAF = requestAnimationFrame(waveTick);
  }

  let lastMediaTitle = null;
  let lastMediaArt = null;
  let lastMediaPlaying = null;
  function updateMedia() {
    ipcRenderer.invoke('get-media').then((info) => {
      const txt = info ? info.text : 'Нет трека';
      const art = info ? info.art : null;
      const playing = !!(info && info.playing);
      const tKey = info ? info.text : '';
      const durMs = info ? info.dur : null;
      const durKind = (durMs && (durMs < 60000 || durMs > 720000)) ? 'other' : 'unknown';
      mediaDurBlocked = durKind === 'other';
      if (tKey !== lastTrackKey) {
        const wasMusic = mediaKind === 'music' && durKind !== 'other';
        lastTrackKey = tKey; mediaKind = wasMusic ? 'music' : durKind; mediaInherited = wasMusic;
        probeFrames = 0; noAnFrames = 0; probeBass = 0; probeMid = 0; probeAll = 0; probeE = [];
        if (mediaActiveFlag) startWave();
      }
      if (txt !== lastMediaTitle) {
        lastMediaTitle = txt;
        mediaTitleA.textContent = txt;
        mediaTitleB.textContent = txt;
        requestAnimationFrame(() => {
          const single = mediaTitleTrack.scrollWidth / 2;
          const overflow = single > mediaTitleClip.clientWidth + 1;
          mediaTitleClip.classList.toggle('marquee', overflow);
          if (overflow) {
            mediaTitleTrack.style.animationDuration = Math.max(4, single / 30) + 's';
          }
        });
      }
      if (art !== lastMediaArt) {
        lastMediaArt = art;
        if (art) {
          mediaArt.src = art;
          mediaArt.classList.add('on');
          mediaArtPh.classList.add('off');
        } else {
          mediaArt.classList.remove('on');
          mediaArtPh.classList.remove('off');
        }
      }
      if (playing !== lastMediaPlaying) {
        lastMediaPlaying = playing;
        const ppIcon = document.getElementById('pp-icon');
        if (ppIcon) ppIcon.src = 'assets/btn/' + (playing ? 'pause.png' : 'play.png');
      }
      if (playing !== lastMediaActive) {
        lastMediaActive = playing;
        mediaActiveFlag = playing && waveEnabled;
        if (mediaActiveFlag) { mediaKind = durKind; mediaDurBlocked = durKind === 'other'; mediaInherited = false; probeFrames = 0; noAnFrames = 0; probeBass = 0; probeMid = 0; probeAll = 0; probeE = []; startWave(); }
      }
    });
  }

  updateMedia();
  setInterval(updateMedia, 2000);
  setInterval(() => {
    if (mediaActiveFlag && mediaKind === 'other' && !mediaDurBlocked) {
      mediaKind = 'unknown'; probeFrames = 0; noAnFrames = 0; probeBass = 0; probeMid = 0; probeAll = 0; probeE = [];
      startWave();
    }
  }, 15000);

  function updatePower() {
    Promise.all([
      ipcRenderer.invoke('get-power').catch(() => null),
      ipcRenderer.invoke('get-bluetooth').catch(() => [])
    ]).then(([power, btList]) => {
      const b = power && power.battery;
      if (b && b.hasBattery && b.percent > 0) {
        batteryInfo.textContent = `🔋 ${Math.round(b.percent)}%${b.isCharging ? ' ⚡' : ''}`;
      } else {
        batteryInfo.textContent = '🔌 Питание: от сети';
      }

      const btByKind = {};
      (btList || []).forEach((d) => {
        const kind = classifyDevice(d.name);
        if (!(kind in btByKind)) btByKind[kind] = d.battery;
      });
      const usbKinds = new Set(((power && power.devices) || []).map((d) => d.kind));

      const badges = [];
      KIND_ORDER.forEach((kind) => {
        const icon = DEVICE_ICONS[kind];
        if (kind in btByKind) {
          badges.push(`${icon} ${btByKind[kind]}%`);
        } else if (usbKinds.has(kind)) {
          badges.push(`${icon}`);
        }
      });
      if (badges.length) {
        deviceInfo.textContent = badges.join('  ');
        deviceInfo.style.display = '';
      } else {
        deviceInfo.textContent = '';
        deviceInfo.style.display = 'none';
      }
    }).catch(() => {});
  }

  updatePower();
  setInterval(updatePower, 120000);

  function updateZapret() {
    ipcRenderer.invoke('zapret-status').then((on) => {
      zapretStatus.className = 'zapret-status ' + (on ? 'on' : 'off');
    }).catch(() => {});
  }

  updateZapret();
  setInterval(updateZapret, 10000);

  zapretBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    zapretBtn.disabled = true;
    zapretStatus.className = 'zapret-status busy';
    ipcRenderer.invoke('zapret-toggle')
      .then((res) => {
        if (res && res.text) {
          zapretStatus.className = 'zapret-status off';
        }
      })
      .catch(() => {
        zapretStatus.className = 'zapret-status err';
      })
      .finally(() => {
        setTimeout(updateZapret, 5000);
        setTimeout(updateZapret, 12000);
        setTimeout(() => { zapretBtn.disabled = false; }, 1500);
      });
  });

  // ---------- ИИ: ленивая загрузка ----------

  let aiUnloadTimer = null;
  let islandOpen = false;

  function setAIStatus(text) {
    chatStatus.textContent = text || '';
  }

  function checkIslandState() {
    const open = island.classList.contains('chat-open');
    if (open === islandOpen) return;
    islandOpen = open;
    if (open) {
      clearTimeout(aiUnloadTimer);
      ipcRenderer.invoke('ai-warm').then((ok) => {
        if (!ok) setAIStatus('ИИ недоступен');
      }).catch(() => setAIStatus('Ошибка загрузки ИИ'));
    } else {
      clearTimeout(aiUnloadTimer);
      aiUnloadTimer = setTimeout(() => {
        ipcRenderer.invoke('ai-unload');
        setAIStatus('');
      }, 20000);
    }
  }

  setInterval(checkIslandState, 500);

  ipcRenderer.on('ai-status', (event, state) => {
    if (state === 'loading') setAIStatus('Загрузка модели…');
    else if (state === 'ready') setAIStatus('');
    else if (state === 'error') setAIStatus('Ошибка загрузки модели');
    else if (state === 'unloaded') setAIStatus('');
  });

  ipcRenderer.on('win-hidden', () => {
    clearTimeout(aiUnloadTimer);
    ipcRenderer.invoke('ai-unload');
    island.classList.remove('chat-open', 'settings-open', 'force-open', 'load-open', 'clip-open', 'translate-open');
    island.classList.remove('voice-hear', 'voice-listening', 'voice-speaking');
    voiceMode = 'off';
    stopRecording();
    setAIStatus('');
  });

  ipcRenderer.on('win-shown', () => {
    if (micStream && voiceMode === 'off') {
      voiceMode = 'idle';
      setVoiceClass();
    }
  });

  // ---------- Чат ----------

  function mdToHtml(src) {
    const esc = String(src)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const out = [];
    let inCode = false;
    for (const rawLine of esc.split('\n')) {
      const line = rawLine;
      if (line.trim().startsWith('```')) {
        out.push(inCode ? '</pre>' : '<pre>');
        inCode = !inCode;
        continue;
      }
      if (inCode) { out.push(line + '\n'); continue; }
      if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')) continue;
      let l = line;
      if (/^\s*\|.*\|\s*$/.test(l)) {
        l = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join(' · ');
      }
      l = l.replace(/^#{1,6}\s*/, '');
      l = l.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      l = l.replace(/\*([^*]+)\*/g, '<i>$1</i>');
      l = l.replace(/`([^`]+)`/g, '<code>$1</code>');
      l = l.replace(/^(\s*)[-*•]\s+/, '$1• ');
      out.push(l);
    }
    return out.join('\n').replace(/\n/g, '<br>');
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  let aiBusy = false;
  let lastQuestion = '';
  let lastAiMsg = null;

  function addChatMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    const body = document.createElement('div');
    body.innerHTML = role === 'user' ? escHtml(text) : mdToHtml(text);
    div.appendChild(body);

    const state = { raw: text };

    if (role === 'ai') {
      const actions = document.createElement('div');
      actions.className = 'chat-actions';

      const regen = document.createElement('button');
      regen.className = 'chat-act';
      regen.textContent = '⟳';
      regen.title = 'Перегенерировать';
      regen.addEventListener('click', (e) => {
        e.stopPropagation();
        regenerate();
      });

      const copy = document.createElement('button');
      copy.className = 'chat-act';
      copy.textContent = '📋';
      copy.title = 'Копировать';
      copy.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(state.raw);
        copy.textContent = '✓';
        setTimeout(() => { copy.textContent = '📋'; }, 1200);
      });

      actions.appendChild(regen);
      actions.appendChild(copy);
      div.appendChild(actions);
    }

    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;

    return {
      div,
      body,
      setText(t) {
        state.raw = t;
        body.innerHTML = mdToHtml(t);
      },
      setError(t) {
        state.raw = t;
        div.className = 'chat-msg error';
        body.textContent = t;
      }
    };
  }

  async function askAI(question, msg) {
    aiBusy = true;
    chatSend.disabled = true;
    setAIStatus('Думаю…');
    try {
      const res = await ipcRenderer.invoke('ai-chat', question);
      if (res.ok) { msg.setText(res.text || '…'); }
      else { msg.setError(res.text || '…'); }
      setAIStatus('');
      aiBusy = false;
      chatSend.disabled = false;
      return res.ok ? (res.text || '') : '';
    } catch (e) {
      msg.setError('Ошибка: ' + e.message);
      setAIStatus('');
      aiBusy = false;
      chatSend.disabled = false;
      return '';
    }
  }

  async function sendChat() {
    const text = chatInput.value.trim();
    if (!text || aiBusy) return;
    chatInput.value = '';
    addChatMsg('user', text);
    lastQuestion = text;
    lastAiMsg = addChatMsg('ai', '…');
    await askAI(text, lastAiMsg);
    chatInput.focus();
  }

  async function regenerate() {
    if (aiBusy || !lastQuestion || !lastAiMsg) return;
    lastAiMsg.div.className = 'chat-msg ai';
    lastAiMsg.body.innerHTML = '…';
    await askAI(lastQuestion, lastAiMsg);
  }

  // ---------- Настройки ----------

  function winH(h) {
    try { ipcRenderer.send('win-height', h); } catch {}
  }

  function closePanels() {
    island.classList.remove('chat-open', 'settings-open', 'load-open', 'clip-open', 'translate-open');
    winH(340);
  }

  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !island.classList.contains('settings-open');
    closePanels();
    if (opening) {
      island.classList.add('settings-open');
      winH(460);
      ipcRenderer.invoke('get-settings').then((s) => {
        zapretPathInput.value = (s && s.zapretBat) || '';
        populateMics(s && s.micDeviceId);
        voiceCheck.checked = !s || s.voice !== false;
      }).catch(() => {});
      ipcRenderer.invoke('get-ai-config').then((c) => {
        if (c) {
          aiBaseInput.value = c.baseUrl || '';
          aiKeyInput.value = c.apiKey || '';
          aiModelInput.value = c.model || '';
        }
      }).catch(() => {});
      ipcRenderer.invoke('get-autostart').then((on) => {
        autostartCheck.checked = !!on;
      }).catch(() => {});
      setTimeout(() => zapretPathInput.focus(), 50);
    }
  });

  async function populateMics(selected) {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const mics = devs.filter((d) => d.kind === 'audioinput');
      micSelect.innerHTML = '';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = 'Микрофон по умолчанию';
      micSelect.appendChild(def);
      mics.forEach((d, i) => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || ('Микрофон ' + (i + 1));
        micSelect.appendChild(o);
      });
      micSelect.value = selected || '';
    } catch (e) { voiceLog('mics enum fail: ' + e.message); }
  }

  micSelect.addEventListener('change', () => {
    ipcRenderer.invoke('save-settings', { micDeviceId: micSelect.value }).catch(() => {});
  });

  settingsCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    island.classList.remove('settings-open');
    winH(340);
  });

  document.getElementById('ai-key-eye').addEventListener('click', (e) => {
    e.stopPropagation();
    aiKeyInput.type = aiKeyInput.type === 'password' ? 'text' : 'password';
  });

  zapretPathInput.addEventListener('click', (e) => e.stopPropagation());
  zapretPathInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') zapretSaveBtn.click();
  });

  autostartCheck.addEventListener('click', (e) => {
    e.stopPropagation();
    const want = autostartCheck.checked;
    setStatus.textContent = 'Запрос UAC…';
    ipcRenderer.invoke('set-autostart', want)
      .then((ok) => {
        autostartCheck.checked = !!ok ? want : !want;
        setStatus.textContent = ok
          ? (want ? 'Автозапуск включён ✓' : 'Автозапуск выключен ✓')
          : 'Отменено или ошибка';
        setTimeout(() => { setStatus.textContent = ''; }, 2500);
      })
      .catch(() => {
        autostartCheck.checked = !want;
        setStatus.textContent = 'Ошибка';
      });
  });

  zapretSaveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const val = zapretPathInput.value.trim();
    setStatus.textContent = 'Сохранение…';
    const settingsP = ipcRenderer.invoke('save-settings', {
      zapretBat: val,
      voice: voiceCheck.checked,
      wave: waveCheck ? waveCheck.checked : true,
    });
    const aiP = ipcRenderer.invoke('save-ai-config', {
      baseUrl: aiBaseInput.value.trim(),
      apiKey: aiKeyInput.value.trim(),
      model: aiModelInput.value.trim()
    });
    Promise.all([settingsP, aiP])
      .then(() => {
        applyVoiceEnabled(voiceCheck.checked);
        setStatus.textContent = 'Сохранено ✓';
        setTimeout(() => { setStatus.textContent = ''; }, 2000);
      })
      .catch(() => { setStatus.textContent = 'Ошибка сохранения'; });
  });

  // Переключатель голоса без сохранения — применяется сразу, в файл пишется тоже
  voiceCheck.addEventListener('change', () => {
    applyVoiceEnabled(voiceCheck.checked);
    ipcRenderer.invoke('save-settings', { voice: voiceCheck.checked }).catch(() => {});
  });

  waveCheck.addEventListener('change', () => {
    waveEnabled = waveCheck.checked;
    if (!waveEnabled) {
      islandWave.classList.remove('on');
      island.classList.remove('media-playing');
      waveC.clearRect(0, 0, waveW, WAVE_H);
      if (waveRAF) { cancelAnimationFrame(waveRAF); waveRAF = 0; }
      bassLevel = 0; waveAmp = 0;
    }
    ipcRenderer.invoke('save-settings', { wave: waveEnabled }).catch(() => {});
  });

  aiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    island.classList.toggle('chat-open');
    winH(340);
    if (island.classList.contains('chat-open')) {
      island.classList.remove('settings-open', 'load-open', 'clip-open', 'translate-open');
      clearTimeout(aiUnloadTimer);
      chatInput.focus();
      ipcRenderer.invoke('ai-warm');
    } else {
      island.classList.remove('force-open');
      island.classList.remove('voice-hear', 'voice-listening', 'voice-speaking');
      if (voiceMode === 'busy' || voiceMode === 'conv' || voiceMode === 'armed') voiceMode = 'idle';
    }
  });

  document.getElementById('chat-back').addEventListener('click', (e) => {
    e.stopPropagation();
    island.classList.remove('chat-open', 'force-open', 'load-open', 'settings-open', 'clip-open', 'translate-open');
    island.classList.remove('voice-hear', 'voice-listening', 'voice-speaking');
    if (voiceMode === 'busy' || voiceMode === 'conv' || voiceMode === 'armed') voiceMode = 'idle';
    setAIStatus('');
    winH(340);
  });

  chatSend.addEventListener('click', (e) => { e.stopPropagation(); sendChat(); });
  chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') sendChat();
  });
  chatInput.addEventListener('click', (e) => e.stopPropagation());

  // ---------- Голосовой помощник ----------

  const WAKE_RE = /вивер[а-яё]*|вифер[а-яё]*|вейвер[а-яё]*|вебер[а-яё]*|ведер[а-яё]*|вив[а-яё]*ру|ви\s*вер[а-яё]*|(^|[\s,;.!?])веру(?=[\s,;.!?]|$)|верум[а-яё]*|первм[а-яё]*|перум[а-яё]*|остров[а-яё]*|островок[а-яё]*|viveru|wiveru/i;
  let voiceMode = 'off'; // off | idle | armed | conv
  let volDucked = false;
  let shutdownPending = false;
  let voiceEnabled = true;
  let convTimer = null;
  let micStream = null, micCtx = null, analyser = null, vadInt = null;
  let recorder = null, recChunks = [], recMime = 'audio/webm', speechOn = false, silenceMs = 0, recStart = 0, recMaxTimer = null;
  const vadData = new Uint8Array(512);

  function setVoiceStatus(text) {
    if (voiceMode !== 'off') setAIStatus(text);
  }

  function setVoiceClass() {
    island.classList.remove('voice-hear', 'voice-listening', 'voice-speaking');
    if (speechOn && (voiceMode === 'armed' || voiceMode === 'conv')) island.classList.add('voice-hear');
    else if (voiceMode === 'armed' || voiceMode === 'conv') island.classList.add('voice-listening');
  }

  function playChime() {
    try {
      const ctx = micCtx || new (window.AudioContext || window.webkitAudioContext)();
      [987.77, 1318.51].forEach((f, i) => {
        const t = ctx.currentTime + i * 0.13;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.25);
      });
    } catch {}
  }

  function convReset() {
    clearTimeout(convTimer);
    convTimer = setTimeout(() => {
      if (voiceMode === 'busy' || voiceMode === 'conv' || voiceMode === 'armed') {
        voiceMode = 'idle';
        setVoiceStatus('');
        setVoiceClass();
      }
    }, 45000);
  }

  function backToSleep() {
    clearTimeout(convTimer);
    clearTimeout(armTimer);
    voiceMode = 'idle';
    setVoiceStatus('');
    setVoiceClass();
  }

  let armTimer = null;
  function wakeAssistant() {
    voiceMode = 'armed';
    clearTimeout(armTimer);
    armTimer = setTimeout(() => {
      if (voiceMode === 'armed') { voiceMode = 'idle'; setVoiceClass(); }
    }, 12000);
    island.classList.remove('settings-open', 'load-open', 'translate-open');
    island.classList.add('force-open', 'chat-open');
    voiceLog('wake -> expanded+chat-open, w=' + island.getBoundingClientRect().width);
    ipcRenderer.invoke('show-window');
    playChime();
    setVoiceStatus('Слушаю… 🎙');
    setVoiceClass();
    convReset();
    chatInput.focus();
  }

  const VOICE_IGNORE = /^(угу|ага|мм+|м+|это|и это|спасибо|пасиб|привет|приветик|здравствуйте|добрый день|добрый вечер|да|нет|ну|э+|э-э|так|вот|ладно|понял|ясно|ок|окей|хорошо|блин|чёрт|черт)[\s!.?,…]*$/i;
  function isVoiceFiller(text) {
    return text.length < 5 || VOICE_IGNORE.test(text);
  }

  // ---------- Локальные команды (без ИИ) ----------

  const OPEN_SITES = {
    "ютуб": "youtube.com", "ютьюб": "youtube.com", "youtube": "youtube.com",
    "яндекс музыка": "music.yandex.ru", "яндекс музыку": "music.yandex.ru",
    "яндекс музыки": "music.yandex.ru", "музыку яндекс": "music.yandex.ru",
    "yandex music": "music.yandex.ru", "yandex музыку": "music.yandex.ru",
    "гугл": "google.com", "google": "google.com",
    "википедия": "wikipedia.org",
    "дискорд": "discord.com/app", "discord": "discord.com/app",
    "стим": "store.steampowered.com", "steam": "store.steampowered.com",
    "чатгпт": "chatgpt.com", "чат гпт": "chatgpt.com", "chatgpt": "chatgpt.com",
    "гитхаб": "github.com", "github": "github.com",
    "вк": "vk.com", "тг": "t.me", "телеграм": "t.me",
    "твиттер": "x.com", "твич": "twitch.tv"
  };
  const APP_ALIASES = {
    "хром": "chrome", "chrome": "chrome",
    "браузер": "msedge", "edge": "msedge", "msedge": "msedge",
    "файрфокс": "firefox", "firefox": "firefox",
    "дискорд": "discord", "discord": "discord",
    "стим": "steam", "steam": "steam",
    "телеграм": "telegram", "telegram": "telegram",
    "вк": "vk",
    "блокнот": "notepad", "notepad": "notepad",
    "калькулятор": "calc", "calc": "calc",
    "проводник": "explorer", "explorer": "explorer",
    "диспетчер задач": "taskmgr", "taskmgr": "taskmgr",
    "пейнт": "mspaint", "paint": "mspaint"
  };

  function normalizeOpenTarget(raw) {
    const s = String(raw || "").toLowerCase().replace(/\s+/g, " ").replace(/[?.!…,;:]+$/g, "").trim();
    if (!s || s.length > 80) return null;
    if (OPEN_SITES[s]) return { type: "url", value: "https://" + OPEN_SITES[s] };
    if (APP_ALIASES[s]) return { type: "app", value: APP_ALIASES[s] };
    if (/^(https?:\/\/|www\.)/i.test(s)) {
      return { type: "url", value: /^https?:\/\//i.test(s) ? s : "https://" + s };
    }
    if (/\.(com|ru|org|net|io|gg|me|tv|app|dev|xyz|site|online|store)(\/|$)/.test(s) && !s.includes(" ")) {
      return { type: "url", value: "https://" + s };
    }
    const app = s.replace(/^сайт\s+/, "");
    if (!app || app.length > 60) return null;
    return { type: "app", value: app };
  }

  function tryLocalVoiceCommand(text) {
    const t = text.toLowerCase();

    if (shutdownPending && /^(отмена|отмени|отменить|погоди|не надо|отбой)(?=[\s,.!?]|$)/.test(t)) {
      shutdownPending = false;
      ipcRenderer.invoke('sys-shutdown', 'abort');
      return 'Отменила выключение';
    }

    if (/который час|которого часа|сколько времени|сколько будет|во сколько|которое время/.test(t)) {
      const d = new Date();
      return `Сейчас ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (/какое число|какая дата|какой день|какое сегодня|какой сегодня|какого числа|которое число/.test(t)) {
      const d = new Date();
      return `Сегодня ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' })}`;
    }
    if (/громче|погромче|добавь звук|звук больше/.test(t)) {
      ipcRenderer.invoke('system-key', 'volume-up');
      return 'Сделала громче';
    }
    if (/тише|потише|убавь звук|звук меньше/.test(t)) {
      ipcRenderer.invoke('system-key', 'volume-down');
      return 'Сделала тише';
    }
    if (/без звука|мут|выключи звук|отключи звук/.test(t)) {
      ipcRenderer.invoke('system-key', 'volume-mute');
      return 'Выключила звук';
    }
    if (/включи звук|звук включи/.test(t)) {
      ipcRenderer.invoke('system-key', 'volume-mute');
      return 'Включила звук';
    }
    if (/пауз|останови|стоп|прекрати/.test(t)) {
      ipcRenderer.invoke('media-control', 'pause');
      setTimeout(updateMedia, 400);
      return 'Поставила на паузу';
    }
    if (/продолжи|играй|воспроизведи|вруби/.test(t)) {
      ipcRenderer.invoke('media-control', 'play');
      setTimeout(updateMedia, 400);
      return 'Включила';
    }
    if (/следующий|дальше|скипай|переключи/.test(t)) {
      ipcRenderer.invoke('media-control', 'next');
      setTimeout(updateMedia, 400);
      return 'Следующий трек';
    }
    if (/предыдущий|прошлый|назад по треку/.test(t)) {
      ipcRenderer.invoke('media-control', 'previous');
      setTimeout(updateMedia, 400);
      return 'Предыдущий трек';
    }

    // --- Выключение / перезагрузка (с отменой) ---
    if (!/^(отмена|отмени|отменить|не выключай)/.test(t) &&
        /(выключи\w*|выключени\w*|выключить|перезагрузи\w*|перезагрузись|перезагрузить|shutdown|рестарт|завершени\w*|заверши|power off|turn off)/.test(t) &&
        /(компьютер|пк|ноутбук|систему|винду|windows|работы|работу|сессию|сеанс)/.test(t)) {
      shutdownPending = true;
      setTimeout(() => { shutdownPending = false; }, 75000);
      ipcRenderer.invoke('sys-shutdown', 'smart');
      return 'Закрою браузеры и выключу компьютер. Скажи «отмена», если передумаешь';
    }
    if (/^(отмена|отмени|отменить)(?=[\s,.!?]|$)/.test(t) && /(выключ|перезагруз|shutdown|рестарт)/.test(t)) {
      ipcRenderer.invoke('sys-shutdown', 'abort');
      return 'Отменила выключение';
    }

    // --- Поиск в интернете ---
    let m = t.match(/(?:найди|погугли|загугли|поищи|поискать|поищите)\s+(.+)/);
    if (m) {
      let q = m[1].replace(/[?.!…]+$/g, '').trim();
      let yt = false;
      if (/в\s*(ютубе|youtube|ютьюбе)/.test(q)) {
        yt = true;
        q = q.replace(/в\s*(ютубе|youtube|ютьюбе)/, '').trim();
      }
      q = q.replace(/в\s*(гугле|google|интернете|сети)/, '').trim();
      if (q) {
        const url = yt
          ? 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q)
          : 'https://www.google.com/search?q=' + encodeURIComponent(q);
        ipcRenderer.invoke('sys-open', { type: 'url', value: url });
        return yt ? 'Ищу «' + q + '» на YouTube' : 'Ищу «' + q + '» в Google';
      }
    }

    // --- Открыть сайт / приложение ---
    m = t.match(/(?:открой|запусти|подними|стартани|запустите|включи)\s+(.+)/);
    if (m) {
      const tgt = m[1].replace(/[?.!…,;:]+$/g, '').trim();
      const ymRe = /(?:(?:яндекс|yandex)\s*(?:музыке|музыку|музыка|music)|(?:музыку|музыка|музыке)\s+(?:яндекс|yandex))(?=[\s,.!?]|$)/;
      if (ymRe.test(tgt)) {
        let q = tgt.replace(ymRe, ' ').replace(/^на\s+/, '').replace(/\s+на$/, '').replace(/\s+/g, ' ').trim();
        q = q.replace(/^(музыку|музыка|трек|песню|исполнителя|исполнитель)\s+/, '');
        if (q && q.length <= 100) {
          const yurl = 'https://music.yandex.ru/search?text=' + encodeURIComponent(q);
          ipcRenderer.invoke('sys-open', { type: 'url', value: yurl });
          return 'Ищу «' + q + '» в Яндекс Музыке';
        }
      }
      if (/^(музыку|песню|трек|звук|радио)(?=[\s,.!?]|$)/.test(tgt) && !/яндекс|yandex/.test(tgt)) {
        ipcRenderer.invoke('media-control', 'play');
        setTimeout(updateMedia, 400);
        return 'Включила';
      }
      if (/^(дискорд|discord)(?=[\s,.!?]|$)/.test(tgt)) {
        ipcRenderer.invoke('open-discord').then((res) => {
          if (res && res.ok === false && lastAiMsg) {
            lastAiMsg.setText(res.stage === 'zapret' ? 'Не смогла запустить Zapret' : 'Не нашла Discord');
          }
        }).catch(() => {});
        return 'Запускаю Discord';
      }
      const norm = normalizeOpenTarget(tgt);
      if (norm) {
        ipcRenderer.invoke('sys-open', norm).then((ok) => {
          if (!ok && lastAiMsg) lastAiMsg.setText('Не нашла «' + tgt + '»');
        }).catch(() => {});
        return 'Открываю ' + tgt;
      }
    }

    // --- Закрыть приложение ---
    m = t.match(/(?:закрой|закрыть|выключи|убей)\s+(.+)/);
    if (m) {
      const tgt = m[1].replace(/[?.!…,;:]+$/g, '').trim();
      if (tgt && !/(компьютер|пк|ноутбук|систему)/.test(tgt)) {
        const name = APP_ALIASES[tgt] || tgt;
        ipcRenderer.invoke('sys-close', name);
        return 'Закрываю ' + tgt;
      }
    }
    return null;
  }

  async function handleTranscript(text) {
    text = String(text || '').trim();
    voiceLog('transcript[' + voiceMode + ']: ' + text);
    if (!text) return;

    if (voiceMode === 'busy') return;

    if (voiceMode === 'idle') {
      const m = text.match(WAKE_RE);
      if (m) {
        const wakeRe = new RegExp(WAKE_RE.source, 'gi');
        const rest = text
          .replace(wakeRe, ' ')
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        wakeAssistant();
        if (rest.length > 2 && !isVoiceFiller(rest)) {
          voiceMode = 'busy';
          chatInput.value = rest;
          dispatchVoiceText(rest);
        }
      }
      return;
    }

    if (voiceMode === 'armed') {
      voiceMode = 'busy';
      setVoiceClass();
      convReset();
      const wakeRe = new RegExp(WAKE_RE.source, 'gi');
      const clean = text
        .replace(wakeRe, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!clean || clean.length < 6 || isVoiceFiller(clean)) { backToSleep(); return; }
      dispatchVoiceText(clean);
    }
  }

  function dispatchVoiceText(text) {
    lastQuestion = text;
    const local = tryLocalVoiceCommand(text);
    if (local != null) {
      voiceLog('local cmd: ' + text + ' -> ' + local);
      addChatMsg('user', text);
      lastAiMsg = addChatMsg('ai', local);
      backToSleep();
      return;
    }
    sendVoiceQuestion(text);
  }

  async function sendVoiceQuestion(text) {
    voiceLog('ask: ' + text);
    if (aiBusy) {
      lastAiMsg = addChatMsg('ai', 'Секунду, я ещё отвечаю на прошлый вопрос');
      return;
    }
    setVoiceStatus('Думаю… 🎙');
    setVoiceClass();
    convReset();
    addChatMsg('user', text);
    lastAiMsg = addChatMsg('ai', '…');
    const answer = await askAI(text, lastAiMsg);
    voiceLog('answer len=' + (answer ? answer.length : 0) + ' head=' + JSON.stringify((answer || '').slice(0, 60)));
    backToSleep();
  }

  async function blobToPcm16k(blob) {
    const ab = await blob.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const tmp = new AC();
    const buf = await tmp.decodeAudioData(ab);
    tmp.close().catch(() => {});
    const dur = buf.duration || 0;
    if (!dur) throw new Error('empty audio');
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(dur * 16000)), 16000);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start(0);
    const rendered = await off.startRendering();
    return rendered.getChannelData(0);
  }

  async function transcribeBlob(blob) {
    try {
      const pcm = await blobToPcm16k(blob);
      const res = await ipcRenderer.invoke('transcribe-pcm', { data: pcm.buffer });
      voiceLog('stt pcm ok=' + (res && res.ok) + ' text=' + JSON.stringify(res && res.text) + ' err=' + (res && res.error) + ' size=' + blob.size);
      if (res && res.ok) return res.text;
    } catch (e) {
      voiceLog('stt pcm exc: ' + e.message);
    }
    try {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
      const b64 = String(dataUrl).split(',')[1] || '';
      const res = await ipcRenderer.invoke('transcribe-audio', { data: b64, mime: blob.type || 'audio/webm' });
      voiceLog('stt res ok=' + (res && res.ok) + ' text=' + JSON.stringify(res && res.text) + ' err=' + (res && res.error) + ' size=' + blob.size);
      if (res && res.ok) return res.text;
    } catch (e) {
      voiceLog('stt exc: ' + e.message);
    }
    return '';
  }

  function duckVol(down) {
    if (down) {
      if (volDucked) return;
      volDucked = true;
      voiceLog('vol duck down');
      try { ipcRenderer.invoke('vol-duck', 'down'); } catch {}
    } else {
      if (!volDucked) return;
      volDucked = false;
      voiceLog('vol duck up');
      try { ipcRenderer.invoke('vol-duck', 'up'); } catch {}
    }
  }

  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch {}
    }
    recorder = null;
    speechOn = false;
    duckVol(false);

    silenceMs = 0;
    setVoiceClass();
    clearTimeout(recMaxTimer);
  }

  function startRecording() {
    recChunks = [];
    try {
      recorder = new MediaRecorder(micStream, { mimeType: 'audio/webm', audioBitsPerSecond: 64000 });
    } catch {
      try { recorder = new MediaRecorder(micStream); } catch { return; }
    }
    recMime = recorder.mimeType || 'audio/webm';
    if (voiceMode === 'armed') duckVol(true);
    setVoiceStatus('Слушаю… 🎙');
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    recorder.onstop = async () => {
      const dur = Date.now() - recStart;
      const mime = recMime || 'audio/webm';
      voiceLog('segment ' + dur + 'ms chunks=' + recChunks.length);
      if (dur < 300 || !recChunks.length) return;
      const blob = new Blob(recChunks, { type: mime });
      const text = await transcribeBlob(blob);
      if (text) handleTranscript(text);
    };
    recorder.start(250);
    recStart = Date.now();
    recMaxTimer = setTimeout(stopRecording, 15000);
  }

  function vadTick() {
    if (!analyser || voiceMode === 'off') return;
    analyser.getByteTimeDomainData(vadData);
    let sum = 0;
    for (let i = 0; i < vadData.length; i++) {
      const v = (vadData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / vadData.length);

    if (!speechOn) {
      if (rms > 0.019) {
        silenceMs = 0;
        if (++_vadHot >= 3) {
          speechOn = true;
          _vadHot = 0;
          startRecording();
          setVoiceClass();
        }
      } else {
        _vadHot = 0;
      }
      return;
    }

    if (rms < 0.012) {
      silenceMs += 60;
      if (silenceMs > 900) {
        speechOn = false;
        silenceMs = 0;
        stopRecording();
      }
    } else {
      silenceMs = 0;
    }
  }
  let _vadHot = 0;

  function applyVoiceEnabled(on) {
    voiceEnabled = !!on;
    if (!voiceEnabled) {
      voiceMode = 'off';
      duckVol(false);
      stopRecording();
        setVoiceClass();
      setAIStatus('');
    } else if (micStream) {
      if (voiceMode === 'off') {
        voiceMode = 'idle';
        setVoiceClass();
      }
    } else {
      initVoice();
    }
  }

  async function initVoice() {
    if (micStream || !voiceEnabled) return;
    try {
      const s = await ipcRenderer.invoke('get-settings').catch(() => null);
      const micId = s && s.micDeviceId;
      const audioCfg = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (micId) audioCfg.deviceId = { ideal: micId };
      micStream = await navigator.mediaDevices.getUserMedia({ audio: audioCfg });
    } catch (e) {
      voiceLog('mic denied: ' + (e && e.message));
      voiceMode = 'off';
      return;
    }
    voiceMode = 'idle';
    voiceLog('mic ok, mode=idle');
    try {
      micCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = micCtx.createMediaStreamSource(micStream);
      analyser = micCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      vadInt = setInterval(vadTick, 60);
    } catch (e) {
      voiceLog('audioctx fail: ' + e.message);
      voiceMode = 'off';
    }
  }

  document.querySelectorAll('.media-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      ipcRenderer.invoke('media-control', btn.dataset.cmd);
      setTimeout(updateMedia, 400);
    });
  });

  // ---------- Панель нагрузки ----------

  function setLoadBar(fill, val, pct) {
    fill.style.width = (pct == null ? 0 : Math.max(0, Math.min(100, pct))) + '%';
    fill.classList.toggle('hot', pct > 70 && pct <= 90);
    fill.classList.toggle('crit', pct > 90);
    val.textContent = pct == null ? '—' : Math.round(pct) + '%';
  }

  let loadBusy = false;
  function updateLoad() {
    if (loadBusy || !island.classList.contains('load-open')) return;
    loadBusy = true;
    ipcRenderer.invoke('get-load').then((d) => {
      if (!d) return;
      setLoadBar(loadCpuFill, loadCpuVal, d.cpu);
      setLoadBar(loadRamFill, loadRamVal, d.ram);
      loadRamVal.textContent = d.ram == null ? '—' : (d.ramText || Math.round(d.ram) + '%');
      if (d.gpu && d.gpu.util != null) {
        setLoadBar(loadGpuFill, loadGpuVal, d.gpu.util);
        const parts = [];
        if (d.gpu.temp != null) parts.push(d.gpu.temp + '°C');
        if (d.gpu.power != null) parts.push(d.gpu.power + 'W');
        if (d.gpu.memUsed && d.gpu.memTotal) parts.push((d.gpu.memUsed / 1024).toFixed(1) + '/' + (d.gpu.memTotal / 1024).toFixed(0) + ' GB');
        loadGpuInfo.textContent = [d.gpuName, ...parts].filter(Boolean).join(' · ');
      } else {
        loadGpuFill.style.width = '0%';
        loadGpuVal.textContent = '—';
        loadGpuInfo.textContent = 'GPU: нет данных';
      }
    }).catch(() => {}).finally(() => { loadBusy = false; });
  }

  setInterval(updateLoad, 3000);

  function renderClipHistory(items) {
    clipList.innerHTML = '';
    if (!items || !items.length) {
      const d = document.createElement('div');
      d.className = 'clip-empty';
      d.textContent = 'Буфер пуст';
      clipList.appendChild(d);
      return;
    }
    items.forEach((t) => {
      const el = document.createElement('div');
      el.className = 'clip-item';
      el.textContent = t.length > 300 ? t.slice(0, 300) + '…' : t;
      el.title = 'Клик — скопировать обратно';
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ipcRenderer.invoke('clipboard-write', t).then((ok) => {
          if (ok) { el.style.background = 'rgba(168,85,247,0.35)'; setTimeout(() => { el.style.background = ''; }, 400); }
        }).catch(() => {});
      });
      clipList.appendChild(el);
    });
  }

  clipBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !island.classList.contains('clip-open');
    closePanels();
    if (opening) {
      island.classList.add('clip-open');
      ipcRenderer.invoke('get-clipboard-history').then(renderClipHistory).catch(() => renderClipHistory([]));
    }
  });

  document.getElementById('clip-back').addEventListener('click', (e) => {
    e.stopPropagation();
    island.classList.remove('clip-open');
    winH(340);
  });

  const trInput = document.getElementById('tr-input');
  const trLang = document.getElementById('tr-lang');
  const trSrc = document.getElementById('tr-src');
  const trResult = document.getElementById('tr-result');
  let trBusy = false;
  let trTimer = null;
  function queueTranslate() {
    clearTimeout(trTimer);
    trTimer = setTimeout(doTranslate, 600);
  }

  translateBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !island.classList.contains('translate-open');
    closePanels();
    if (opening) {
      island.classList.add('translate-open');
      winH(340);
      setTimeout(() => trInput.focus(), 50);
    }
  });

  document.getElementById('translate-back').addEventListener('click', (e) => {
    e.stopPropagation();
    island.classList.remove('translate-open');
    winH(340);
  });

  async function doTranslate() {
    const text = trInput.value.trim();
    if (!text) { trResult.textContent = ''; return; }
    if (trBusy) return;
    trBusy = true;
    trResult.textContent = '…';
    try {
      const res = await ipcRenderer.invoke('translate', { text, src: trSrc.value, lang: trLang.value });
      trResult.textContent = (res && res.ok && res.text) ? res.text : ('Ошибка: ' + ((res && res.error) || 'нет ответа'));
    } catch (err) {
      trResult.textContent = 'Ошибка: ' + (err && err.message ? err.message : err);
    } finally {
      trBusy = false;
    }
  }

  document.getElementById('tr-swap').addEventListener('click', (e) => {
    e.stopPropagation();
    const t = trSrc.value;
    trSrc.value = trLang.value;
    trLang.value = t;
    queueTranslate();
  });

  trInput.addEventListener('input', queueTranslate);
  trSrc.addEventListener('change', queueTranslate);
  trLang.addEventListener('change', queueTranslate);
  document.getElementById('tr-copy').addEventListener('click', (e) => {
    e.stopPropagation();
    const t = trResult.textContent;
    if (!t) return;
    ipcRenderer.invoke('clipboard-write', t).then((ok) => {
      const b = document.getElementById('tr-copy');
      b.textContent = ok ? 'Скопировано ✓' : 'Ошибка копирования';
      setTimeout(() => { b.textContent = 'Скопировать результат'; }, 1200);
    }).catch(() => {});
  });

  loadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !island.classList.contains('load-open');
    closePanels();
    if (opening) {
      island.classList.add('load-open');
      updateLoad();
    }
  });

  document.getElementById('load-back').addEventListener('click', (e) => {
    e.stopPropagation();
    island.classList.remove('load-open', 'clip-open', 'translate-open');
    winH(340);
  });

  chatClear.addEventListener('click', (e) => {
    e.stopPropagation();
    chatLog.innerHTML = '';
    lastAiMsg = null;
    lastQuestion = '';
  });

  // Старт: подтягиваем настройки, потом решаем, нужен ли микрофон
  ipcRenderer.invoke('get-settings').then((s) => {
    voiceEnabled = !s || s.voice !== false;
    waveEnabled = !s || s.wave !== false;
    if (waveCheck) waveCheck.checked = waveEnabled;
    voiceCheck.checked = voiceEnabled;
    if (voiceEnabled) initVoice();
  }).catch(() => { voiceCheck.checked = true; initVoice(); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
