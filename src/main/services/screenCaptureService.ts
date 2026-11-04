import type { DesktopCapturerSource } from 'electron';
import { desktopCapturer } from 'electron';
import type { DesktopSourceInfo, Result, ScreenshotData } from '@shared/types';
import { err, ok } from '@shared/types';
import { logDiag } from './diagnosticsLogger';

export interface DesktopCapturerLike {
  getSources: (options: {
    types: ('screen' | 'window')[];
    thumbnailSize?: { width: number; height: number };
    fetchWindowIcons?: boolean;
  }) => Promise<DesktopCapturerSource[]>;
}

export interface ScreenCaptureServiceOptions {
  capturer?: DesktopCapturerLike;
}

/**
 * Dedicated ScreenCaptureService.
 *
 * Guarantees:
 * 1. Capture is initiated ONLY by an explicit user request.
 * 2. Strictly single screenshot acquisition — no continuous recording or streams left running.
 * 3. Compresses full-resolution screenshot to high quality JPEG for fast Gemini multimodal processing.
 * 4. Never logs base64 data, credentials, or confidential screen bytes.
 */
export class ScreenCaptureService {
  private readonly capturer: DesktopCapturerLike;

  constructor(options?: ScreenCaptureServiceOptions) {
    this.capturer = options?.capturer ?? desktopCapturer;
  }

  /**
   * Enumerates available screen and window sources with lightweight preview thumbnails.
   */
  async getAvailableSources(): Promise<Result<DesktopSourceInfo[]>> {
    try {
      const sources = await this.capturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });

      const formatted: DesktopSourceInfo[] = sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnailUrl: s.thumbnail ? s.thumbnail.toDataURL() : '',
        displayId: s.display_id,
        isScreen: s.id.startsWith('screen:'),
      }));

      logDiag('ScreenDiag:01-Sources', 'Enumerated available screen and window capture sources', {
        count: formatted.length,
        screens: formatted.filter((f) => f.isScreen).length,
        windows: formatted.filter((f) => !f.isScreen).length,
      });

      return ok(formatted);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      logDiag('ScreenDiag:01-Sources', 'Failed to enumerate capture sources', { error: msg });
      return err('SOURCE_FAILED', `Failed to enumerate screen sources: ${msg}`);
    }
  }

  /**
   * Captures a single static screenshot of the specified source or the primary screen.
   * Stops immediately after acquiring the native image buffer.
   */
  async capture(sourceId?: string): Promise<Result<ScreenshotData>> {
    const startTime = Date.now();
    try {
      logDiag('ScreenDiag:02-Capture', 'Initiating explicit screenshot capture', {
        requestedSourceId: sourceId || 'primary-screen',
      });

      const sources = await this.capturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 1920, height: 1080 },
      });

      if (!sources || sources.length === 0) {
        logDiag('ScreenDiag:02-Capture', 'Capture failed: no capture sources available');
        return err('SOURCE_FAILED', 'No screen or window sources found to capture.');
      }

      let targetSource: DesktopCapturerSource | undefined;
      if (sourceId) {
        targetSource = sources.find((s) => s.id === sourceId);
      }

      // If requested source not found or unspecified, pick the first screen source or first available
      if (!targetSource) {
        targetSource = sources.find((s) => s.id.startsWith('screen:')) ?? sources[0];
      }

      if (!targetSource || !targetSource.thumbnail) {
        return err('SOURCE_FAILED', 'Target screen source or thumbnail was unavailable.');
      }

      const size = targetSource.thumbnail.getSize();
      if (size.width === 0 || size.height === 0) {
        return err('SOURCE_FAILED', 'Captured screenshot has invalid empty dimensions.');
      }

      // Encode high quality JPEG (quality 85 retains code & text sharpness while keeping size ~200KB)
      const jpegBuffer = targetSource.thumbnail.toJPEG(85);
      const base64 = jpegBuffer.toString('base64');
      const dataUrl = `data:image/jpeg;base64,${base64}`;

      const screenshot: ScreenshotData = {
        id: `scr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sourceId: targetSource.id,
        sourceName: targetSource.name,
        dataUrl,
        base64,
        width: size.width,
        height: size.height,
        capturedAt: new Date().toISOString(),
      };

      const durationMs = Date.now() - startTime;
      logDiag('ScreenDiag:02-Capture', 'Screenshot captured successfully', {
        id: screenshot.id,
        sourceName: screenshot.sourceName,
        width: size.width,
        height: size.height,
        byteSize: jpegBuffer.byteLength,
        durationMs,
      });

      return ok(screenshot);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      logDiag('ScreenDiag:02-Capture', 'Screenshot capture failed with error', { error: msg });
      return err('SOURCE_FAILED', `Screen capture failed: ${msg}`);
    }
  }
}
