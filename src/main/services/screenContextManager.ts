import type { ScreenshotData } from '@shared/types';
import { logDiag } from './diagnosticsLogger';

export interface ScreenTurn {
  question: string;
  answer: string;
  timestamp: string;
}

/**
 * Manages the active visual screenshot context and multi-turn visual conversation turns.
 * Strictly guarantees that pending screenshots are not active until confirmed by the user.
 */
export class ScreenContextManager {
  private pendingScreenshot: ScreenshotData | null = null;
  private activeScreenshot: ScreenshotData | null = null;
  private historyTurns: ScreenTurn[] = [];

  setPending(screenshot: ScreenshotData): void {
    this.pendingScreenshot = screenshot;
    logDiag('ScreenDiag:02-Context', 'Pending screenshot staged for user review', {
      id: screenshot.id,
      sourceName: screenshot.sourceName,
      width: screenshot.width,
      height: screenshot.height,
    });
  }

  getPending(): ScreenshotData | null {
    return this.pendingScreenshot;
  }

  confirm(screenshotId: string): boolean {
    if (this.pendingScreenshot && this.pendingScreenshot.id === screenshotId) {
      this.activeScreenshot = this.pendingScreenshot;
      this.pendingScreenshot = null;
      this.historyTurns = [];
      logDiag('ScreenDiag:03-Context', 'Screenshot confirmed as active visual context', {
        id: this.activeScreenshot.id,
        sourceName: this.activeScreenshot.sourceName,
      });
      return true;
    }
    return false;
  }

  discard(screenshotId?: string): boolean {
    if (this.pendingScreenshot && (!screenshotId || this.pendingScreenshot.id === screenshotId)) {
      logDiag('ScreenDiag:03-Context', 'Pending screenshot discarded', {
        id: this.pendingScreenshot.id,
      });
      this.pendingScreenshot = null;
      return true;
    }
    return false;
  }

  clear(): void {
    this.pendingScreenshot = null;
    this.activeScreenshot = null;
    this.historyTurns = [];
    logDiag('ScreenDiag:03-Context', 'Active visual context cleared');
  }

  getConfirmed(): ScreenshotData | null {
    return this.activeScreenshot;
  }

  hasContext(): boolean {
    return this.activeScreenshot !== null;
  }

  addTurn(question: string, answer: string): void {
    this.historyTurns.push({
      question,
      answer,
      timestamp: new Date().toISOString(),
    });
    // Keep last 10 turns to conserve prompt token length while maintaining continuity
    if (this.historyTurns.length > 10) {
      this.historyTurns.shift();
    }
  }

  getTurns(): ScreenTurn[] {
    return [...this.historyTurns];
  }
}
