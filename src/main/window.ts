import { app, BrowserWindow, shell, screen } from 'electron';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LayoutSettings, WindowBounds, WindowMode } from '@shared/types';

export const APP_NAME = 'GigaAgent';
export const APP_ID = 'com.gigaagent.desktop';

export const COMPACT_SIZE = { width: 400, height: 660, minWidth: 340, minHeight: 480 } as const;
export const EXPANDED_SIZE = { width: 1240, height: 780, minWidth: 940, minHeight: 560 } as const;

const devUrl = (): string | undefined =>
  app?.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'] || 'http://localhost:5173';

/**
 * Only the app's own renderer may be loaded in the window:
 *  - development: the exact Vite dev-server origin
 *  - production: the bundled index.html (and nothing else on the file system)
 */
export function isAppUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const dev = devUrl();
  if (dev) {
    try {
      if (parsed.origin === new URL(dev).origin) return true;
    } catch {
      // fall through
    }
    if (parsed.origin === 'http://localhost:5173') return true;
  }
  if (parsed.protocol === 'file:') {
    // Packaged app: restrict to the renderer bundle. (Tests/dev without a packaged app keep the broad rule.)
    if (!app?.isPackaged) return true;
    const base = pathToFileURL(join(__dirname, '../renderer') + sep).href.toLowerCase();
    return parsed.href.toLowerCase().startsWith(base);
  }
  return false;
}

/** External links: https only, never credentials-in-URL, opened in the user's browser. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

interface DisplayLike {
  workArea: { x: number; y: number; width: number; height: number };
}

/** Keeps a remembered window position usable after monitors are unplugged or rearranged. */
export function clampToDisplays(bounds: WindowBounds, displays: DisplayLike[], min: { minWidth: number; minHeight: number }): WindowBounds | null {
  const visible = displays.some((d) => {
    const a = d.workArea;
    const overlapW = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const overlapH = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    return overlapW >= 120 && overlapH >= 80;
  });
  if (!visible) return null;
  return { ...bounds, width: Math.max(min.minWidth, bounds.width), height: Math.max(min.minHeight, bounds.height) };
}

export function defaultBounds(mode: WindowMode, workArea: DisplayLike['workArea']): WindowBounds {
  if (mode === 'compact') {
    return {
      x: workArea.x + workArea.width - COMPACT_SIZE.width - 20,
      y: workArea.y + 40,
      width: COMPACT_SIZE.width,
      height: Math.min(COMPACT_SIZE.height, workArea.height - 60),
    };
  }
  const width = Math.min(EXPANDED_SIZE.width, workArea.width - 40);
  const height = Math.min(EXPANDED_SIZE.height, workArea.height - 40);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}

export function resolveBounds(mode: WindowMode, layout: LayoutSettings): WindowBounds {
  const primary = screen.getPrimaryDisplay();
  const saved = mode === 'compact' ? layout.compactBounds : layout.expandedBounds;
  const limits = mode === 'compact' ? COMPACT_SIZE : EXPANDED_SIZE;
  const clamped = saved ? clampToDisplays(saved, screen.getAllDisplays(), limits) : null;
  return clamped ?? defaultBounds(mode, primary.workArea);
}

/** Applies compact/expanded geometry. Compact floats above other windows when the user wants it to. */
export function applyWindowMode(win: BrowserWindow, mode: WindowMode, layout: LayoutSettings): void {
  if (win.isDestroyed()) return;
  const limits = mode === 'compact' ? COMPACT_SIZE : EXPANDED_SIZE;
  // Lower the minimum first so shrinking back to compact is never blocked by the larger minimum.
  win.setMinimumSize(COMPACT_SIZE.minWidth, COMPACT_SIZE.minHeight);
  win.setBounds(resolveBounds(mode, layout), false);
  win.setMinimumSize(limits.minWidth, limits.minHeight);
  setAlwaysOnTop(win, mode === 'compact' && layout.alwaysOnTop);
  try {
    if (mode === 'compact' && layout.clickThrough !== false) {
      win.setIgnoreMouseEvents(true, { forward: true });
    } else {
      win.setIgnoreMouseEvents(false);
    }
  } catch {}
}

export function setAlwaysOnTop(win: BrowserWindow, value: boolean): void {
  if (win.isDestroyed()) return;
  if (process.platform === 'darwin') {
    win.setAlwaysOnTop(value, value ? 'floating' : 'normal');
  } else {
    win.setAlwaysOnTop(value);
  }
}

export interface CreateWindowOptions {
  layout: LayoutSettings;
  /** Initial Ghost Mode state. Applied before the window is first shown. */
  contentProtection: boolean;
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  const mode: WindowMode = options.layout.expanded ? 'expanded' : 'compact';
  const limits = mode === 'compact' ? COMPACT_SIZE : EXPANDED_SIZE;
  const bounds = resolveBounds(mode, options.layout);

  const win = new BrowserWindow({
    ...bounds,
    minWidth: limits.minWidth,
    minHeight: limits.minHeight,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: mode === 'compact' && options.layout.alwaysOnTop,
    title: APP_NAME,
    hasShadow: true,
    resizable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app?.isPackaged,
    },
  });

  // Ghost Mode follows the user's saved choice from the very first frame.
  win.setContentProtection(options.contentProtection);
  setAlwaysOnTop(win, mode === 'compact' && options.layout.alwaysOnTop);
  try {
    if (mode === 'compact' && options.layout.clickThrough !== false) {
      win.setIgnoreMouseEvents(true, { forward: true });
    }
  } catch {}

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    if (!app?.isPackaged && process.env['GIGAAGENT_DEVTOOLS'] === '1') win.webContents.openDevTools({ mode: 'detach' });
  });

  // Fallback: If ready-to-show hasn't fired after 1.5s, force show and focus
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
      win.focus();
    }
  }, 1500);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  // No <webview>, ever.
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

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
