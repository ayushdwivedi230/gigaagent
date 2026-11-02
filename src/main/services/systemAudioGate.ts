import type { BrowserWindow, DesktopCapturerSource } from 'electron';
import { desktopCapturer } from 'electron';
import { isAppUrl } from '../window';

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

  constructor(armTimeoutMs = 5000) {
    this.armTimeoutMs = armTimeoutMs;
  }

  arm(): void {
    this.armed = true;
    if (this.armTimer) clearTimeout(this.armTimer);
    this.armTimer = setTimeout(() => {
      this.armed = false;
    }, this.armTimeoutMs);
  }

  disarm(): void {
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
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { valid: false, reason: 'Main window is not available or has been destroyed' };
    }

    const topFrame = request.frame?.top;
    if (!topFrame || topFrame !== mainWindow.webContents.mainFrame) {
      return { valid: false, reason: 'Requesting frame is not the authenticated main window frame' };
    }

    if (!request.securityOrigin || !isAppUrl(request.securityOrigin)) {
      return { valid: false, reason: `Untrusted security origin: ${request.securityOrigin ?? 'unknown'}` };
    }

    if (!request.userGesture) {
      return { valid: false, reason: 'Capture request lacks mandatory user gesture activation' };
    }

    if (!this.armed) {
      return { valid: false, reason: 'Capture request arrived while system audio gate was disarmed' };
    }

    if (!request.videoRequested || !request.audioRequested) {
      return { valid: false, reason: 'Capture request must request both video and audio tracks' };
    }

    // Immediately disarm after a valid request is verified to prevent replay
    this.disarm();
    return { valid: true };
  }

  async selectDesktopSource(): Promise<DesktopCapturerSource | null> {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      return sources[0] ?? null;
    } catch (err) {
      console.error('[SystemAudioGate] Failed to enumerate screen capture sources', err);
      return null;
    }
  }
}

