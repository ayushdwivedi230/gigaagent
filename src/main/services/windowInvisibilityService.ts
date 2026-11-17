import { BrowserWindow, screen } from 'electron';
import os from 'node:os';
import { logDiag } from './diagnosticsLogger';
import type { GhostState, InvisibilityStatus } from '@shared/types';

/**
 * Win32 SetWindowDisplayAffinity constants:
 * WDA_NONE = 0x00000000 (Capture enabled, default)
 * WDA_MONITOR = 0x00000001 (Legacy capture protection, renders a black box)
 * WDA_EXCLUDEFROMCAPTURE = 0x00000011 (17 decimal)
 * Available on Windows 10 Version 2004 (build 19041) and newer, including Windows 11.
 * Completely excludes the window from Desktop Duplication, Windows Graphics Capture,
 * Zoom, Google Meet, Teams, OBS, Discord, and native screenshot tools.
 */
export const WDA_NONE = 0x00000000;
export const WDA_MONITOR = 0x00000001;
export const WDA_EXCLUDEFROMCAPTURE = 0x00000011;

/**
 * macOS NSWindowSharingType constants:
 * NSWindowSharingNone = 0 (Window contents not readable by other processes or ScreenCaptureKit)
 * NSWindowSharingReadOnly = 1 (Default)
 */
export const NS_WINDOW_SHARING_NONE = 0;
export const NS_WINDOW_SHARING_READ_ONLY = 1;

/** First Windows 10 build that supports WDA_EXCLUDEFROMCAPTURE (version 2004). */
export const WIN_EXCLUDE_MIN_BUILD = 19041;

export interface GhostSupport {
  supported: boolean;
  mechanism: string;
  /** Honest, user-facing description of what the mechanism does and does not do. */
  detail: string;
}

/**
 * Ghost Mode is the operating system's own window capture-exclusion flag, nothing more.
 * It asks the OS compositor to leave this window out of screen captures made on this computer.
 * It does not hide the process, the taskbar entry, audio capture, or network activity, and it
 * offers no protection against monitoring software, cameras, or capture tools that ignore the flag.
 */
export function detectGhostSupport(platform: string = process.platform, release: string = os.release()): GhostSupport {
  const limits =
    'It does not hide the app from Task Manager, the taskbar, monitoring or proctoring software, or a camera pointed at the screen, and it must not be relied on as undetectable.';
  if (platform === 'win32') {
    const build = Number(release.split('.')[2] ?? 0);
    if (build >= WIN_EXCLUDE_MIN_BUILD) {
      return {
        supported: true,
        mechanism: 'WDA_EXCLUDEFROMCAPTURE (0x00000011)',
        detail: `Windows leaves this window out of screenshots, screen recordings and screen sharing made on this PC (SetWindowDisplayAffinity). ${limits}`,
      };
    }
    return {
      supported: true,
      mechanism: 'WDA_MONITOR (0x00000001)',
      detail: `This Windows version predates capture exclusion (needs Windows 10 2004+). The window shows as a black rectangle in captures instead of being left out. ${limits}`,
    };
  }
  if (platform === 'darwin') {
    return {
      supported: true,
      mechanism: 'NSWindowSharingNone (0)',
      detail: `macOS is asked not to share this window's contents with other apps (NSWindow.sharingType). Newer macOS capture APIs may still include it. ${limits}`,
    };
  }
  return {
    supported: false,
    mechanism: 'UNSUPPORTED',
    detail: 'This operating system has no window capture-exclusion API, so Ghost Mode cannot be turned on here.',
  };
}

export class WindowInvisibilityService {
  private win: BrowserWindow | null = null;
  private enabled: boolean = true;
  private lastAppliedAt: string = '';
  private lastError?: string;
  private isDisposed: boolean = false;
  private state: GhostState = 'off';
  private readonly support: GhostSupport;
  private readonly onChange: ((status: InvisibilityStatus) => void) | undefined;
  private boundListeners: Array<{ target: { removeListener: (evt: string, fn: (...args: any[]) => void) => void }; event: string; fn: (...args: any[]) => void }> = [];

  constructor(options?: { enabled?: boolean; onChange?: (status: InvisibilityStatus) => void; support?: GhostSupport }) {
    this.enabled = options?.enabled ?? true;
    this.onChange = options?.onChange;
    this.support = options?.support ?? detectGhostSupport();
    if (!this.support.supported) this.state = 'unsupported';
  }

  getSupport(): GhostSupport {
    return this.support;
  }

  /**
   * Attaches invisibility management to a target BrowserWindow and registers
   * comprehensive lifecycle listeners to prevent the flag from being lost.
   */
  attach(win: BrowserWindow): void {
    if (this.isDisposed || win.isDestroyed()) return;
    this.win = win;

    // Apply immediately upon attachment
    this.applyInvisibility(this.enabled);

    const addListener = (target: any, event: string, fn: (...args: any[]) => void) => {
      if (!target || typeof target.on !== 'function') return;
      target.on(event, fn);
      this.boundListeners.push({ target, event, fn });
    };

    // 1. ready-to-show & show: Window becomes visible on screen
    addListener(win, 'ready-to-show', () => this.reassert('ready-to-show'));
    addListener(win, 'show', () => this.reassert('show'));

    // 2. restore: Window un-minimized by user or system
    addListener(win, 'restore', () => this.reassert('restore'));

    // 3. focus: Window gains user focus
    addListener(win, 'focus', () => this.reassert('focus'));

    // 4. moved: fires once when a drag ends (e.g. onto another monitor).
    //    The continuous 'move' event is deliberately NOT used: it fires dozens of times per second.
    addListener(win, 'moved', () => this.reassert('moved'));

    // 5. always-on-top changed
    addListener(win, 'always-on-top-changed', () => this.reassert('always-on-top-changed'));

    // 6. Display changes (monitors plugged/unplugged, resolution change)
    if (screen && typeof screen.on === 'function') {
      addListener(screen, 'display-metrics-changed', () => this.reassert('display-metrics-changed'));
      addListener(screen, 'display-added', () => this.reassert('display-added'));
    }

    win.once('closed', () => {
      this.cleanupListeners();
      this.win = null;
    });
  }

  /**
   * Retrieves the native OS window handle (HWND on Windows, NSView/NSWindow on macOS).
   */
  getHwnd(): bigint | number | null {
    if (!this.win || this.win.isDestroyed()) return null;
    try {
      const handleBuf = this.win.getNativeWindowHandle();
      if (!handleBuf || handleBuf.length === 0) return null;
      if (handleBuf.length === 8) {
        return handleBuf.readBigUInt64LE(0);
      }
      return handleBuf.readUInt32LE(0);
    } catch {
      return null;
    }
  }

  /**
   * Applies or removes screen-share capture exclusion across Windows and macOS.
   */
  applyInvisibility(enable: boolean): InvisibilityStatus {
    this.enabled = enable;
    if (!this.win || this.win.isDestroyed()) {
      return this.getStatus();
    }

    const platform = process.platform;
    const hwnd = this.getHwnd();
    const hwndHex = hwnd ? `0x${hwnd.toString(16)}` : undefined;

    if (!this.support.supported) {
      this.state = 'unsupported';
      this.lastError = undefined;
      this.notify();
      return this.getStatus();
    }

    this.state = 'applying';
    try {
      // Electron's first-party content protection is the whole mechanism:
      //   Windows 10 2004+/11 → SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
      //   macOS              → [nsWindow setSharingType:NSWindowSharingNone]
      // The call must come from the process that owns the window, which Electron guarantees.
      // (The previous out-of-process PowerShell P/Invoke could never succeed for that reason
      //  and spawned a shell on every window event; it has been removed.)
      if (typeof this.win.setContentProtection !== 'function') {
        throw new Error('This Electron build does not expose setContentProtection.');
      }
      this.win.setContentProtection(enable);

      this.lastAppliedAt = new Date().toISOString();
      this.lastError = undefined;
      this.state = enable ? 'active' : 'off';

      logDiag('WindowInvisibility', 'Window capture exclusion applied', {
        enabled: enable,
        platform,
        affinityFlag: this.getAffinityName(),
        hwnd: hwndHex,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.lastError = errMsg;
      this.state = 'error';
      logDiag('WindowInvisibility:Error', 'Failed to apply window capture exclusion', {
        error: errMsg,
        platform,
        hwnd: hwndHex,
      });
    }

    this.notify();
    return this.getStatus();
  }

  private notify(): void {
    try {
      this.onChange?.(this.getStatus());
    } catch {
      // A failing listener must never break window management.
    }
  }

  /**
   * Re-asserts the invisibility configuration on lifecycle transitions.
   */
  private reassert(reason: string): void {
    if (!this.enabled || !this.support.supported || !this.win || this.win.isDestroyed()) return;
    try {
      if (typeof this.win.setContentProtection === 'function') {
        this.win.setContentProtection(true);
      }
      if (this.state !== 'active') {
        this.state = 'active';
        this.lastError = undefined;
        this.notify();
      }
    } catch (err) {
      this.lastError = String(err);
      this.state = 'error';
      logDiag('WindowInvisibility:ReassertError', `Failed to reassert capture exclusion on ${reason}`, {
        error: String(err),
      });
      this.notify();
    }
  }

  getAffinityName(): string {
    if (process.platform === 'win32') return 'WDA_EXCLUDEFROMCAPTURE (0x00000011)';
    if (process.platform === 'darwin') return 'NSWindowSharingNone (0)';
    return 'UNSUPPORTED';
  }

  getStatus(): InvisibilityStatus {
    const hwnd = this.getHwnd();
    return {
      enabled: this.enabled,
      platform: process.platform,
      affinityFlag: this.getAffinityName(),
      hwndHex: hwnd ? `0x${hwnd.toString(16)}` : undefined,
      lastAppliedAt: this.lastAppliedAt || new Date().toISOString(),
      error: this.lastError,
      state: this.state,
      supported: this.support.supported,
      detail: this.support.detail,
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enable: boolean): InvisibilityStatus {
    return this.applyInvisibility(enable);
  }

  private cleanupListeners(): void {
    for (const { target, event, fn } of this.boundListeners) {
      try {
        target.removeListener(event, fn);
      } catch {}
    }
    this.boundListeners = [];
  }

  destroy(): void {
    this.isDisposed = true;
    this.cleanupListeners();
    this.win = null;
  }
}
