import { err, MODE_LABELS, ok } from '@shared/types';
import type {
  AppError,
  RawSegment,
  Result,
  SessionDetail,
  SessionEvent,
  SessionMode,
  SessionSnapshot,
  SessionStatus,
  SessionSummary,
  StartSessionRequest,
} from '@shared/types';
import type { SessionRepository } from './sessionRepository';
import type { TranscriptSource } from './transcriptSource';

export interface SessionServiceDeps {
  repository: SessionRepository;
  createSource: (mode: SessionMode) => TranscriptSource;
  now?: () => Date;
  newId?: () => string;
}

interface ActiveSession {
  summary: SessionSummary;
  source: TranscriptSource;
  finalIds: Set<string>;
}

type Listener = (event: SessionEvent) => void;

/**
 * Owns the session lifecycle: idle -> starting -> active -> stopping -> idle.
 * Pure Node (no Electron imports) so it can be unit tested directly.
 */
export class SessionService {
  private status: SessionStatus = 'idle';
  private active: ActiveSession | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly repository: SessionRepository;
  private readonly createSource: (mode: SessionMode) => TranscriptSource;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(deps: SessionServiceDeps) {
    this.repository = deps.repository;
    this.createSource = deps.createSource;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SessionSnapshot {
    return {
      status: this.status,
      activeSession: this.active ? { ...this.active.summary } : null,
    };
  }

  listSessions(): SessionSummary[] {
    return this.repository.list();
  }

  getSession(id: string): Result<SessionDetail> {
    const detail = this.repository.get(id);
    return detail ? ok(detail) : err('NOT_FOUND', 'That session no longer exists.');
  }

  async start(request: StartSessionRequest): Promise<Result<SessionSnapshot>> {
    if (this.status !== 'idle') {
      return err('BUSY', 'A session is already running. Stop it before starting another.');
    }

    const source = this.createSource(request.mode);
    const summary: SessionSummary = {
      id: this.newId(),
      title: request.title ?? MODE_LABELS[request.mode],
      mode: request.mode,
      source: source.kind,
      startedAt: this.now().toISOString(),
      endedAt: null,
      segmentCount: 0,
    };
    const active: ActiveSession = { summary, source, finalIds: new Set() };

    // Claim the slot synchronously so a double-click cannot start two sources.
    this.status = 'starting';
    this.active = active;
    this.repository.create(summary);
    this.emitStatus();

    try {
      await source.start(
        (raw) => this.handleSegment(active, raw),
        (error) => this.emit({ type: 'error', error }),
      );
    } catch (cause) {
      this.repository.delete(summary.id);
      this.active = null;
      this.status = 'idle';
      this.emitStatus();
      const message =
        cause instanceof Error && cause.message
          ? cause.message
          : 'The session could not start. Check your audio settings and try again.';
      return { ok: false, error: { code: 'SOURCE_FAILED', message } };
    }

    this.status = 'active';
    this.emitStatus();
    return ok(this.getSnapshot());
  }

  async stop(): Promise<Result<SessionSummary>> {
    const active = this.active;
    if (this.status !== 'active' || !active) {
      return err('NO_ACTIVE_SESSION', 'No session is running.');
    }

    this.status = 'stopping';
    this.emitStatus();

    try {
      await active.source.stop();
    } catch {
      this.emit({
        type: 'error',
        error: { code: 'SOURCE_FAILED', message: 'The audio source did not shut down cleanly.' },
      });
    }

    active.summary.endedAt = this.now().toISOString();
    this.repository.update(active.summary);
    this.active = null;
    this.status = 'idle';
    this.emitStatus();
    return ok({ ...active.summary });
  }

  deleteSession(id: string): Result<{ deleted: number }> {
    if (this.active?.summary.id === id) {
      return err('SESSION_ACTIVE', 'Stop the session before deleting it.');
    }
    return this.repository.delete(id)
      ? ok({ deleted: 1 })
      : err('NOT_FOUND', 'That session no longer exists.');
  }

  clearHistory(): Result<{ deleted: number }> {
    if (this.active) {
      return err('SESSION_ACTIVE', 'Stop the current session before deleting history.');
    }
    return ok({ deleted: this.repository.clear() });
  }

  private handleSegment(active: ActiveSession, raw: RawSegment): void {
    // Ignore anything a source emits after its session ended.
    if (this.active !== active) return;
    const segment = { ...raw, sessionId: active.summary.id };
    this.repository.upsertSegment(segment);
    if (segment.isFinal && !active.finalIds.has(segment.id)) {
      active.finalIds.add(segment.id);
      active.summary.segmentCount = active.finalIds.size;
      this.repository.update(active.summary);
    }
    this.emit({ type: 'segment', segment });
  }

  private emitStatus(): void {
    this.emit({ type: 'status', snapshot: this.getSnapshot() });
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (cause) {
        // A broken listener (e.g. a closed window) must never break the session.
        console.error('[session] listener failed', cause);
      }
    }
  }
}

export type { AppError };
