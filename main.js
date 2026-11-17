const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');
const path = require('path');

app.disableHardwareAcceleration();

let win;

const WINDOW = { width: 600, height: 300 };

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.round((width - WINDOW.width) / 2);
  const y = 0;

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

  win.on('hide', () => console.log('WINDOW HIDDEN:', new Error().stack));

  win.show();
  win.loadFile('index.html');
  win.on('did-finish-load', () => win.show());
  win.setAlwaysOnTop(true, 'screen-saver');
}

app.whenReady().then(() => {
  ipcMain.handle('get-uptime', (event) => new Promise((resolve) => {
    exec(
      'powershell -NoProfile -Command "[int]((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalSeconds"',
      { timeout: 10000 },
      (err, stdout) => {
        const secs = parseInt(stdout, 10);
        resolve(Number.isFinite(secs) && secs > 0 ? secs : os.uptime());
      }
    );
  }));

  ipcMain.handle('get-media', async () => {
    try {
      const { current } = await import('now-playing-media');
      const session = await current();
      if (!session || !session.track) {
        return null;
      }
      const { title, artist } = session.track;
      if (!title && !artist) return null;
      return {
        text: [title, artist].filter(Boolean).join(' — '),
        playing: session.playback.status === 'Playing'
      };
    } catch {
      return null;
    }
  });

  ipcMain.on('capture', async () => {
    const img = await win.webContents.capturePage();
    const { width, height } = img.getSize();
    const bmp = img.getBitmap();
    let opaque = 0, dark = 0;
    for (let i = 0; i < bmp.length; i += 4) {
      const a = bmp[i + 3];
      if (a > 200) {
        opaque++;
        if (bmp[i] < 40 && bmp[i + 1] < 40 && bmp[i + 2] < 40) dark++;
      }
    }
    console.log(`CAPTURE ${width}x${height} opaque=${opaque} dark=${dark}`);
  });

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

  createWindow();

  const toggle = () => {
    if (win.isVisible()) win.hide();
    else win.show();
  };
  globalShortcut.register('CommandOrControl+Alt+I', toggle);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
