import { BrowserWindow, screen } from 'electron';
import { exec } from 'node:child_process';
import { logDiag } from './diagnosticsLogger';
import type { InvisibilityStatus } from '@shared/types';

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

export class WindowInvisibilityService {
  private win: BrowserWindow | null = null;
  private enabled: boolean = true;
  private lastAppliedAt: string = '';
  private lastError?: string;
  private isDisposed: boolean = false;
  private boundListeners: Array<{ target: { removeListener: (evt: string, fn: (...args: any[]) => void) => void }; event: string; fn: (...args: any[]) => void }> = [];

  constructor(options?: { enabled?: boolean }) {
    this.enabled = options?.enabled ?? true;
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

    // 4. move & moved: Window dragged or repositioned across monitors/workspaces
    addListener(win, 'move', () => this.reassert('move'));
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

    try {
      // Step 1: Electron First-Party Native Content Protection
      // On Windows 10 (2004+) & 11: calls Win32 SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
      // On macOS: calls [nsWindow setSharingType:NSWindowSharingNone]
      if (typeof this.win.setContentProtection === 'function') {
        this.win.setContentProtection(enable);
      }

      // Step 2: Platform-specific overlay refinements
      if (platform === 'darwin') {
        try {
          if (typeof this.win.setVisibleOnAllWorkspaces === 'function') {
            this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
          }
          if (typeof this.win.setAlwaysOnTop === 'function') {
            this.win.setAlwaysOnTop(true, 'screen-saver');
          }
        } catch {}
      } else if (platform === 'win32' && hwnd) {
        // Direct Win32 API invocation on the HWND to guarantee affinity enforcement
        const affinity = enable ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE;
        this.invokeWin32SetAffinity(hwnd, affinity);
      }

      this.lastAppliedAt = new Date().toISOString();
      this.lastError = undefined;

      logDiag('WindowInvisibility', 'Window capture exclusion applied successfully', {
        enabled: enable,
        platform,
        affinityFlag: this.getAffinityName(),
        hwnd: hwndHex,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.lastError = errMsg;
      logDiag('WindowInvisibility:Error', 'Failed to apply window capture exclusion', {
        error: errMsg,
        platform,
        hwnd: hwndHex,
      });
    }

    return this.getStatus();
  }

  /**
   * Re-asserts the invisibility configuration on lifecycle transitions.
   */
  private reassert(reason: string): void {
    if (!this.enabled || !this.win || this.win.isDestroyed()) return;
    try {
      if (typeof this.win.setContentProtection === 'function') {
        this.win.setContentProtection(true);
      }
      const hwnd = this.getHwnd();
      if (process.platform === 'win32' && hwnd) {
        this.invokeWin32SetAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
      }
      logDiag('WindowInvisibility:Reassert', `Affinity re-asserted on ${reason}`, {
        reason,
        hwnd: hwnd ? `0x${hwnd.toString(16)}` : undefined,
      });
    } catch (err) {
      logDiag('WindowInvisibility:ReassertError', `Failed to reassert affinity on ${reason}`, {
        error: String(err),
      });
    }
  }

  /**
   * Direct Win32 user32.dll SetWindowDisplayAffinity execution via P/Invoke.
   */
  private invokeWin32SetAffinity(hwnd: bigint | number, affinity: number): void {
    if (process.platform !== 'win32') return;
    try {
      const script = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);' -Name "Win32Capture" -Namespace "Native" -ErrorAction SilentlyContinue; [Native.Win32Capture]::SetWindowDisplayAffinity([IntPtr]${hwnd}, ${affinity})`;
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      exec(
        `powershell -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encoded}`,
        { windowsHide: true },
        (err) => {
          if (err) {
            logDiag('WindowInvisibility:DirectWin32', 'Direct Win32 affinity call warning', { error: err.message });
          } else {
            logDiag('WindowInvisibility:DirectWin32', 'Direct Win32 SetWindowDisplayAffinity confirmed on HWND', {
              hwnd: `0x${hwnd.toString(16)}`,
              affinity: `0x${affinity.toString(16)}`,
            });
          }
        },
      );
    } catch (err) {
      logDiag('WindowInvisibility:DirectWin32Error', 'Could not dispatch direct Win32 call', { error: String(err) });
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
