import { applySegment } from '@shared/transcript';
import type {
  LibraryItem,
  LibraryQuery,
  SaveLibraryItemRequest,
  SessionDetail,
  SessionSummary,
  SuggestionItem,
  TranscriptSearchHit,
  TranscriptSegment,
} from '@shared/types';

/** Saved answers, quick-capture notes, prompt templates and preparation profiles. */
export interface LibraryStore {
  listLibrary(query?: LibraryQuery): LibraryItem[];
  getLibraryItem(id: string): LibraryItem | undefined;
  saveLibraryItem(request: SaveLibraryItemRequest, now?: string): LibraryItem;
  deleteLibraryItem(id: string): boolean;
  clearLibrary(): number;
  searchTranscripts(query: string, limit?: number): TranscriptSearchHit[];
}

/** Storage boundary. Swapped for SQLite in Milestone 3. */
export interface SessionRepository {
  create(summary: SessionSummary): void;
  update(summary: SessionSummary): void;
  upsertSegment(segment: TranscriptSegment): void;
  upsertSuggestion?(suggestion: SuggestionItem): void;
  /** Newest first. */
  list(): SessionSummary[];
  get(id: string): SessionDetail | undefined;
  delete(id: string): boolean;
  /** Returns how many sessions were removed. */
  clear(): number;
  flush?(): void;
  close?(): void;
  getHealth?(): 'healthy' | 'recovered' | 'corrupted' | 'in_memory';
}

export class InMemorySessionRepository implements SessionRepository, LibraryStore {
  private readonly sessions = new Map<string, SessionDetail>();
  private readonly library = new Map<string, LibraryItem>();

  create(summary: SessionSummary): void {
    this.sessions.set(summary.id, { summary: { ...summary }, segments: [], suggestions: [] });
  }

  update(summary: SessionSummary): void {
    const entry = this.sessions.get(summary.id);
    if (entry) entry.summary = { ...summary };
  }

  upsertSegment(segment: TranscriptSegment): void {
    const entry = this.sessions.get(segment.sessionId);
    if (entry) entry.segments = applySegment(entry.segments, { ...segment });
  }

  upsertSuggestion(suggestion: SuggestionItem): void {
    const entry = this.sessions.get(suggestion.sessionId);
    if (entry) {
      if (!entry.suggestions) entry.suggestions = [];
      const idx = entry.suggestions.findIndex((s) => s.id === suggestion.id);
      if (idx === -1) {
        entry.suggestions.push({ ...suggestion });
      } else {
        entry.suggestions[idx] = { ...suggestion };
      }
    }
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
    return {
      summary: { ...entry.summary },
      segments: entry.segments.map((s) => ({ ...s })),
      suggestions: entry.suggestions ? entry.suggestions.map((s) => ({ ...s })) : [],
    };
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  clear(): number {
    const count = this.sessions.size;
    this.sessions.clear();
    return count;
  }

  listLibrary(query: LibraryQuery = {}): LibraryItem[] {
    const needle = query.search?.toLowerCase();
    return [...this.library.values()]
      .filter((i) => !query.kind || i.kind === query.kind)
      .filter((i) => !query.sessionId || i.sessionId === query.sessionId)
      .filter((i) => !needle || [i.title, i.content, i.question ?? '', i.tags.join(' ')].some((t) => t.toLowerCase().includes(needle)))
      .reverse()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((i) => ({ ...i, tags: [...i.tags] }));
  }

  getLibraryItem(id: string): LibraryItem | undefined {
    const item = this.library.get(id);
    return item ? { ...item, tags: [...item.tags] } : undefined;
  }

  saveLibraryItem(request: SaveLibraryItemRequest, now: string = new Date().toISOString()): LibraryItem {
    const existing = request.id ? this.library.get(request.id) : undefined;
    const item: LibraryItem = {
      id: existing?.id ?? request.id ?? globalThis.crypto.randomUUID(),
      kind: request.kind,
      title: request.title,
      content: request.content,
      tags: request.tags ?? existing?.tags ?? [],
      sessionId: request.sessionId !== undefined ? request.sessionId : (existing?.sessionId ?? null),
      question: request.question !== undefined ? request.question : (existing?.question ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.library.set(item.id, item);
    return { ...item, tags: [...item.tags] };
  }

  deleteLibraryItem(id: string): boolean {
    return this.library.delete(id);
  }

  clearLibrary(): number {
    const count = this.library.size;
    this.library.clear();
    return count;
  }

  searchTranscripts(query: string, limit = 100): TranscriptSearchHit[] {
    const needle = query.toLowerCase();
    const hits: TranscriptSearchHit[] = [];
    for (const summary of this.list()) {
      for (const seg of this.sessions.get(summary.id)?.segments ?? []) {
        if (hits.length >= limit) return hits;
        if (seg.isFinal && seg.text.toLowerCase().includes(needle)) {
          hits.push({
            sessionId: summary.id,
            sessionTitle: summary.title,
            startedAt: summary.startedAt,
            segmentId: seg.id,
            speaker: seg.speaker,
            startMs: seg.startMs,
            text: seg.text,
          });
        }
      }
    }
    return hits;
  }
}
