import { BrowserWindow } from 'electron';

/**
 * SVG for the standard Windows/macOS high-resolution arrow cursor.
 * Rendered with an authentic dark drop shadow so it appears natural over any background app.
 */
const DECOY_CURSOR_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 28px; height: 28px; background: transparent; overflow: hidden; }
  svg { width: 24px; height: 24px; display: block; filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.7)); }
</style>
</head>
<body>
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M4.5 3L11.5 20.5L14.2 13.8L21 11L4.5 3Z" fill="#ffffff" stroke="#111111" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>
</body>
</html>`;

/**
 * Decoy Cursor Service: Creates and manages a frozen decoy cursor on screen share
 *
 * How it works:
 * 1. Creates a tiny (28x28), frameless, transparent, click-through secondary window.
 * 2. Crucially, this decoy window has `setContentProtection(false)` — meaning screen capture
 *    streams (Zoom, Meet, Teams, OBS) CAPTURE IT.
 * 3. When the user's cursor enters GigaAgent's floating overlay window, this decoy window is
 *    immediately positioned at the entry coordinates (screenX, screenY) and made visible.
 * 4. To everyone on Google Meet / Zoom, the cursor appears completely frozen/stuck at that spot
 *    on the background app (e.g. VS Code), as if the user stopped moving their mouse to read.
 * 5. Meanwhile, inside GigaAgent, the real cursor is hidden from the OS (`cursor: none`) and a
 *    private in-app cursor moves smoothly for the user's eyes only.
 * 6. When the user exits GigaAgent, the decoy cursor is hidden instantly, and the real OS cursor resumes.
 */
export class DecoyCursorService {
  private window: BrowserWindow | null = null;
  private isVisible: boolean = false;
  private enabled: boolean = true;

  constructor(options?: { enabled?: boolean }) {
    this.enabled = options?.enabled ?? true;
  }

  init(): void {
    if (this.window && !this.window.isDestroyed()) return;

    try {
      this.window = new BrowserWindow({
        width: 28,
        height: 28,
        useContentSize: true,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        resizable: false,
        show: false,
        hasShadow: false,
        backgroundColor: '#00000000',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      // Decoy window MUST be captured by screen share
      this.window.setContentProtection(false);
      this.window.setIgnoreMouseEvents(true);

      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(DECOY_CURSOR_HTML)}`;
      void this.window.loadURL(dataUrl);
    } catch (err) {
      console.warn('[DecoyCursorService] Failed to initialize decoy cursor window', err);
    }
  }

  showAt(x: number, y: number): void {
    if (!this.enabled) return;
    if (!this.window || this.window.isDestroyed()) {
      this.init();
    }
    if (!this.window || this.window.isDestroyed()) return;

    try {
      this.window.setBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: 28,
        height: 28,
      });
      if (!this.isVisible) {
        this.isVisible = true;
        this.window.showInactive();
      }
    } catch {}
  }

  hide(): void {
    if (!this.window || this.window.isDestroyed()) return;
    try {
      if (this.isVisible) {
        this.isVisible = false;
        this.window.hide();
      }
    } catch {}
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.hide();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      try {
        this.window.destroy();
      } catch {}
    }
    this.window = null;
    this.isVisible = false;
  }
}
