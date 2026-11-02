import { app, BrowserWindow, shell, screen } from 'electron';
import { join } from 'node:path';

export const APP_NAME = 'AI Meeting Assistant';

const devUrl = (): string | undefined =>
  app?.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];

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

  // Highest always-on-top level so it floats above video call windows
  win.setAlwaysOnTop(true, 'screen-saver');

  win.once('ready-to-show', () => {
    win.show();
    if (!app.isPackaged) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });

  const dev = devUrl();
  if (dev) void win.loadURL(dev);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));

  return win;
}
