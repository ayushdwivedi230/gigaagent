import type { BrowserWindow, DesktopCapturerSource } from 'electron';
import { desktopCapturer } from 'electron';
import { isAppUrl } from '../window';
import { logDiag } from './diagnosticsLogger';

export interface DisplayMediaRequestLike {
  frame?: {
    top?: unknown;
  } | null;
  securityOrigin?: string;
  videoRequested?: boolean;
  audioRequested?: boolean;
  userGesture?: boolean;
}

export type GateValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Security gate for Chromium WASAPI display media loopback capture.
 *
 * Enforces mandatory constraints:
 * 1. Authenticates requesting frame via request.frame, its top frame relationship,
 *    and request.securityOrigin (does not rely on request.webContents).
 * 2. Requires request.userGesture === true AND an explicit user arming gate.
 * 3. Verifies request.videoRequested && request.audioRequested.
 * 4. Disarms immediately after validation or timeout.
 */
export class SystemAudioGate {
  private armed = false;
  private armTimer: NodeJS.Timeout | null = null;
  private readonly armTimeoutMs: number;

  constructor(armTimeoutMs = 8000) {
    this.armTimeoutMs = armTimeoutMs;
  }

  arm(): void {
    this.armed = true;
    logDiag('SysAudioDiag:01-Gate', 'System audio gate ARMED', { timeoutMs: this.armTimeoutMs });
    if (this.armTimer) clearTimeout(this.armTimer);
    this.armTimer = setTimeout(() => {
      if (this.armed) {
        logDiag('SysAudioDiag:01-Gate', 'System audio gate TIMED OUT and disarmed automatically');
        this.armed = false;
      }
    }, this.armTimeoutMs);
  }

  disarm(): void {
    if (this.armed) {
      logDiag('SysAudioDiag:01-Gate', 'System audio gate disarmed explicitly');
    }
    this.armed = false;
    if (this.armTimer) {
      clearTimeout(this.armTimer);
      this.armTimer = null;
    }
  }

  isArmed(): boolean {
    return this.armed;
  }

  validateRequest(
    request: DisplayMediaRequestLike,
    mainWindow: BrowserWindow | null,
  ): GateValidationResult {
    logDiag('SysAudioDiag:03-GateValidation', 'Validating display media capture request', {
      hasWindow: Boolean(mainWindow && !mainWindow.isDestroyed()),
      securityOrigin: request.securityOrigin,
      userGesture: Boolean(request.userGesture),
      isArmed: this.armed,
      videoRequested: Boolean(request.videoRequested),
      audioRequested: Boolean(request.audioRequested),
    });

    if (!mainWindow || mainWindow.isDestroyed()) {
      const reason = 'Main window is not available or has been destroyed';
      logDiag('SysAudioDiag:03-GateValidation', 'Validation FAILED', { reason });
      return { valid: false, reason };
    }

    const topFrame = request.frame?.top;
    if (!topFrame || topFrame !== mainWindow.webContents.mainFrame) {
      const reason = 'Requesting frame is not the authenticated main window frame';
      logDiag('SysAudioDiag:03-GateValidation', 'Validation FAILED', { reason });
      return { valid: false, reason };
    }

    if (!request.securityOrigin || !isAppUrl(request.securityOrigin)) {
      const reason = `Untrusted security origin: ${request.securityOrigin ?? 'unknown'}`;
      logDiag('SysAudioDiag:03-GateValidation', 'Validation FAILED', { reason });
      return { valid: false, reason };
    }

    if (!request.userGesture) {
      const reason = 'Capture request lacks mandatory user gesture activation';
      logDiag('SysAudioDiag:03-GateValidation', 'Validation FAILED', { reason });
      return { valid: false, reason };
    }

    if (!this.armed) {
      const reason = 'Capture request arrived while system audio gate was disarmed';
      logDiag('SysAudioDiag:03-GateValidation', 'Validation FAILED', { reason });
      return { valid: false, reason };
    }

    if (!request.videoRequested || !request.audioRequested) {
      const reason = 'Capture request must request both video and audio tracks';
      logDiag('SysAudioDiag:03-GateValidation', 'Validation FAILED', { reason });
      return { valid: false, reason };
    }

    // Immediately disarm after a valid request is verified to prevent replay
    this.disarm();
    logDiag('SysAudioDiag:03-GateValidation', 'Validation PASSED. Gate successfully disarmed');
    return { valid: true };
  }

  async selectDesktopSource(): Promise<DesktopCapturerSource | null> {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      logDiag('SysAudioDiag:04-SourceSelection', 'Desktop capture sources enumerated', {
        count: sources.length,
        sources: sources.map((s) => ({ id: s.id, name: s.name })),
      });
      const selected = sources[0] ?? null;
      if (selected) {
        logDiag('SysAudioDiag:04-SourceSelection', 'Primary desktop source selected', {
          id: selected.id,
          name: selected.name,
        });
      }
      return selected;
    } catch (err) {
      logDiag('SysAudioDiag:04-SourceSelection', 'Failed to enumerate screen capture sources', {
        error: String(err),
      });
      console.error('[SystemAudioGate] Failed to enumerate screen capture sources', err);
      return null;
    }
  }
}

