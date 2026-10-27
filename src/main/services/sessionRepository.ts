import { applySegment } from '@shared/transcript';
import type { SessionDetail, SessionSummary, TranscriptSegment } from '@shared/types';

/** Storage boundary. Milestone 5 swaps the in-memory implementation for SQLite. */
export interface SessionRepository {
  create(summary: SessionSummary): void;
  update(summary: SessionSummary): void;
  upsertSegment(segment: TranscriptSegment): void;
  /** Newest first. */
  list(): SessionSummary[];
  get(id: string): SessionDetail | undefined;
  delete(id: string): boolean;
  /** Returns how many sessions were removed. */
  clear(): number;
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, SessionDetail>();

  create(summary: SessionSummary): void {
    this.sessions.set(summary.id, { summary: { ...summary }, segments: [] });
  }

  update(summary: SessionSummary): void {
    const entry = this.sessions.get(summary.id);
    if (entry) entry.summary = { ...summary };
  }

  upsertSegment(segment: TranscriptSegment): void {
    const entry = this.sessions.get(segment.sessionId);
    if (entry) entry.segments = applySegment(entry.segments, { ...segment });
  }

  list(): SessionSummary[] {
    // Reverse insertion order first so ties on startedAt keep "newest first" after the stable sort.
    return [...this.sessions.values()]
      .reverse()
      .map((e) => ({ ...e.summary }))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  get(id: string): SessionDetail | undefined {
    const entry = this.sessions.get(id);
    if (!entry) return undefined;
    return { summary: { ...entry.summary }, segments: entry.segments.map((s) => ({ ...s })) };
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  clear(): number {
    const count = this.sessions.size;
    this.sessions.clear();
    return count;
  }
}
