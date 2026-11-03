import { app, BrowserWindow, shell, screen } from 'electron';
import { join } from 'node:path';

export const APP_NAME = 'AI Meeting Assistant';

const devUrl = (): string | undefined =>
  app?.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5173';

export function isAppUrl(url: string): boolean {
  const dev = devUrl();
  if (dev && url.startsWith(dev)) return true;
  if (url.startsWith('file://')) return true;
  if (!app?.isPackaged && url.startsWith('http://localhost:5173')) return true;
  return false;
}

export function createMainWindow(): BrowserWindow {
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: 380,
    height: 680,
    minWidth: 320,
    minHeight: 460,
    // Place in top-right corner, 20px from edge
    x: sw - 400,
    y: 40,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    title: APP_NAME,
    hasShadow: true,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Keep on top of other desktop windows
  win.setAlwaysOnTop(true);

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    if (!app?.isPackaged) win.webContents.openDevTools({ mode: 'detach' });
  });

  // Fallback: If ready-to-show hasn't fired after 1.5s, force show and focus
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
      win.focus();
    }
  }, 1500);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });

  const dev = devUrl();
  if (dev) {
    win.loadURL(dev).catch((err) => {
      console.warn('[window] Initial loadURL failed, retrying in 1s...', err);
      setTimeout(() => {
        if (!win.isDestroyed()) void win.loadURL(dev);
      }, 1000);
    });
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
