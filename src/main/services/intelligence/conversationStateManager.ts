import type { SessionMode } from '@shared/types';
import { logDiag } from '../diagnosticsLogger';

export class ConversationStateManager {
  private activeSessionId: string | null = null;
  private currentMode: SessionMode = 'mock-interview';
  private isGenerating = false;
  private requestIdCounter = 0;
  private lastAnsweredQuestion: string | null = null;

  setSession(sessionId: string | null, mode: SessionMode = 'mock-interview'): void {
    this.activeSessionId = sessionId;
    this.currentMode = mode;
    this.isGenerating = false;
    this.lastAnsweredQuestion = null;
    logDiag('StateManager:Session', 'Conversation session state set', { sessionId, mode });
  }

  getSessionId(): string | null {
    return this.activeSessionId;
  }

  getMode(): SessionMode {
    return this.currentMode;
  }

  setMode(mode: SessionMode): void {
    this.currentMode = mode;
  }

  startRequest(): number {
    this.isGenerating = true;
    return ++this.requestIdCounter;
  }

  completeRequest(reqId: number, question?: string): boolean {
    // If a newer request has already started, this one is stale!
    const isLatest = reqId === this.requestIdCounter;
    this.isGenerating = false;
    if (isLatest && question) {
      this.lastAnsweredQuestion = question;
    }
    return isLatest;
  }

  isLatestRequest(reqId: number): boolean {
    return reqId === this.requestIdCounter;
  }

  getIsGenerating(): boolean {
    return this.isGenerating;
  }

  getLastAnswered(): string | null {
    return this.lastAnsweredQuestion;
  }
}
