import { logDiag } from '../diagnosticsLogger';

export interface GuardEntry {
  text: string;
  normalized: string;
  timestamp: number;
}

export class DuplicateResponseGuard {
  private readonly cooldownMs: number;
  private recentQueries: GuardEntry[] = [];
  private inFlightTexts: Set<string> = new Set();

  constructor(cooldownMs = 12000) {
    this.cooldownMs = cooldownMs;
  }

  normalize(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .replace(/[?!.,;:'"()]/g, '')
      .replace(/\s+/g, ' ');
  }

  isDuplicate(text: string): boolean {
    const norm = this.normalize(text);
    if (!norm) return true;

    const now = Date.now();
    // Clean expired entries
    this.recentQueries = this.recentQueries.filter(
      (q) => now - q.timestamp < this.cooldownMs,
    );

    // 1. Check in-flight
    if (this.inFlightTexts.has(norm)) {
      logDiag('DuplicateGuard:Blocked', 'In-flight duplicate request blocked', { text });
      return true;
    }

    // 2. Check recently completed queries
    const match = this.recentQueries.find((q) => q.normalized === norm);
    if (match) {
      logDiag('DuplicateGuard:Blocked', 'Recent duplicate query within cooldown blocked', {
        text,
        ageMs: now - match.timestamp,
      });
      return true;
    }

    return false;
  }

  markInFlight(text: string): void {
    const norm = this.normalize(text);
    if (norm) {
      this.inFlightTexts.add(norm);
    }
  }

  recordCompleted(text: string): void {
    const norm = this.normalize(text);
    if (norm) {
      this.inFlightTexts.delete(norm);
      this.recentQueries.push({
        text,
        normalized: norm,
        timestamp: Date.now(),
      });
    }
  }

  releaseInFlight(text: string): void {
    const norm = this.normalize(text);
    if (norm) {
      this.inFlightTexts.delete(norm);
    }
  }

  clear(): void {
    this.recentQueries = [];
    this.inFlightTexts.clear();
  }
}
