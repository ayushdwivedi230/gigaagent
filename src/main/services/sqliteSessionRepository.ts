import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';
import { escapeLike } from '@shared/validation';
import type {
  LibraryItem,
  LibraryKind,
  LibraryQuery,
  SaveLibraryItemRequest,
  SessionDetail,
  SessionMode,
  SessionSummary,
  SourceKind,
  SpeakerKind,
  SuggestionItem,
  TranscriptSearchHit,
  TranscriptSegment,
} from '@shared/types';
import type { LibraryStore, SessionRepository } from './sessionRepository';

export interface SqliteRepositoryOptions {
  filePath?: string | null;
}

export interface SchemaMigration {
  version: number;
  description: string;
  up: (db: SqlJsDatabase) => void;
}

export const MIGRATIONS: SchemaMigration[] = [
  {
    version: 1,
    description: 'Initial schema: sessions, transcript_segments, and suggestions tables',
    up: (db: SqlJsDatabase) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          mode TEXT NOT NULL,
          source TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          duration_ms INTEGER,
          segment_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS transcript_segments (
          id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          start_ms INTEGER NOT NULL,
          end_ms INTEGER,
          text TEXT NOT NULL,
          is_final INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (session_id, id),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS suggestions (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_segments_session_start ON transcript_segments(session_id, start_ms);
        CREATE INDEX IF NOT EXISTS idx_suggestions_session_time ON suggestions(session_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
      `);
    },
  },
  {
    version: 2,
    description: 'Add speaker column and speaker index to transcript_segments table',
    up: (db: SqlJsDatabase) => {
      const tableInfo = db.exec('PRAGMA table_info(transcript_segments);');
      const columns = tableInfo[0]?.values?.map((col) => col[1]) || [];
      if (!columns.includes('speaker')) {
        db.run("ALTER TABLE transcript_segments ADD COLUMN speaker TEXT NOT NULL DEFAULT 'user';");
        db.run('CREATE INDEX IF NOT EXISTS idx_segments_speaker ON transcript_segments(session_id, speaker);');
      }
    },
  },
  {
    version: 3,
    description: 'GigaAgent 3.0: library_items table; question + metadata columns on suggestions',
    up: (db: SqlJsDatabase) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS library_items (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          session_id TEXT,
          question TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_library_kind_updated ON library_items(kind, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_library_session ON library_items(session_id);
      `);
      const info = db.exec('PRAGMA table_info(suggestions);');
      const columns = info[0]?.values?.map((col) => col[1]) || [];
      if (!columns.includes('question')) db.run('ALTER TABLE suggestions ADD COLUMN question TEXT;');
      if (!columns.includes('meta')) db.run("ALTER TABLE suggestions ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';");
    },
  },
];

/** Suggestion fields persisted as JSON so history shows answers exactly as they were generated. */
const SUGGESTION_META_KEYS = [
  'source',
  'isQuestion',
  'formatType',
  'modelUsed',
  'hasVisualContext',
  'intent',
  'programmingLanguage',
  'followUpSuggestions',
  'answerFormat',
  'speakingTargetSec',
  'action',
  'tool',
] as const;

export class SqliteSessionRepository implements SessionRepository, LibraryStore {
  private db: SqlJsDatabase;
  private readonly filePath: string | null;
  private isPersisting = false;
  private hasPendingChanges = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private health: 'healthy' | 'recovered' | 'corrupted' | 'in_memory' = 'healthy';

  private constructor(
    db: SqlJsDatabase,
    filePath: string | null,
    health: 'healthy' | 'recovered' | 'corrupted' | 'in_memory' = 'healthy',
  ) {
    this.db = db;
    this.filePath = filePath;
    this.health = health;
  }

  getHealth(): 'healthy' | 'recovered' | 'corrupted' | 'in_memory' {
    return this.health;
  }

  static async create(options: SqliteRepositoryOptions = {}): Promise<SqliteSessionRepository> {
    const SQL = await initSqlJs();
    const filePath = options.filePath ?? null;

    let db: SqlJsDatabase = new SQL.Database();
    let health: 'healthy' | 'recovered' | 'corrupted' | 'in_memory' = filePath ? 'healthy' : 'in_memory';

    if (filePath && fs.existsSync(filePath)) {
      try {
        const fileBuffer = fs.readFileSync(filePath);
        db = new SQL.Database(fileBuffer);
        // Verify database integrity
        const check = db.exec('PRAGMA quick_check;');
        const checkResult = check[0]?.values?.[0]?.[0];
        if (checkResult !== 'ok') {
          throw new Error(`PRAGMA quick_check returned: ${checkResult}`);
        }
      } catch (err) {
        console.warn(`[SqliteSessionRepository] Corrupted primary database detected at ${filePath}. Attempting backup recovery.`, err);
        const backupPath = `${filePath}.bak`;
        let recovered = false;

        if (fs.existsSync(backupPath)) {
          try {
            const backupBuffer = fs.readFileSync(backupPath);
            db = new SQL.Database(backupBuffer);
            const check = db.exec('PRAGMA quick_check;');
            if (check[0]?.values?.[0]?.[0] === 'ok') {
              console.log(`[SqliteSessionRepository] Successfully recovered database from backup: ${backupPath}`);
              health = 'recovered';
              recovered = true;
            }
          } catch (bakErr) {
            console.warn('[SqliteSessionRepository] Backup database also corrupted', bakErr);
          }
        }

        if (!recovered) {
          try {
            const corruptPath = `${filePath}.corrupt.${Date.now()}`;
            fs.renameSync(filePath, corruptPath);
          } catch {}
          db = new SQL.Database();
          health = 'corrupted';
        }
      }
    } else {
      db = new SQL.Database();
    }

    const repository = new SqliteSessionRepository(db, filePath, health);
    repository.initialize();
    return repository;
  }

  private initialize(): void {
    // Enforce foreign key constraints for cascade deletion
    this.db.run('PRAGMA foreign_keys = ON;');
    this.repairOrphans();

    // Setup migration tracking table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT NOT NULL
      );
    `);

    this.runMigrations();
    this.persist();
  }

  /**
   * Pre-3.0 builds lost `PRAGMA foreign_keys` after the first save (sql.js reopens the database
   * inside export()), so deleting a session could leave its transcript and answers behind.
   * Remove any such leftovers so "deleted" really means deleted.
   */
  private repairOrphans(): void {
    try {
      const tables = this.db.exec("SELECT name FROM sqlite_master WHERE type = 'table';");
      const names = new Set((tables[0]?.values ?? []).map((row) => String(row[0])));
      if (!names.has('sessions')) return;
      if (names.has('transcript_segments')) {
        this.db.run('DELETE FROM transcript_segments WHERE session_id NOT IN (SELECT id FROM sessions);');
      }
      if (names.has('suggestions')) {
        this.db.run('DELETE FROM suggestions WHERE session_id NOT IN (SELECT id FROM sessions);');
      }
    } catch (err) {
      console.warn('[SqliteSessionRepository] Orphan cleanup skipped', err);
    }
  }

  private runMigrations(): void {
    const res = this.db.exec('SELECT max(version) FROM schema_migrations;');
    let currentVersion = 0;
    if (res.length > 0 && res[0]?.values?.[0]?.[0] !== undefined && res[0].values[0][0] !== null) {
      currentVersion = Number(res[0].values[0][0]);
    }

    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        this.db.run('BEGIN TRANSACTION;');
        try {
          migration.up(this.db);
          this.db.run(
            'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?);',
            [migration.version, new Date().toISOString(), migration.description],
          );
          this.db.run(`PRAGMA user_version = ${migration.version};`);
          this.db.run('COMMIT;');
        } catch (err) {
          this.db.run('ROLLBACK;');
          console.error(`[SqliteSessionRepository] Migration ${migration.version} failed`, err);
          throw err;
        }
      }
    }
  }

  create(summary: SessionSummary): void {
    const duration = summary.endedAt
      ? Math.max(0, new Date(summary.endedAt).getTime() - new Date(summary.startedAt).getTime())
      : null;

    this.db.run(
      `INSERT INTO sessions (id, title, mode, source, started_at, ended_at, duration_ms, segment_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        summary.id,
        summary.title,
        summary.mode,
        summary.source,
        summary.startedAt,
        summary.endedAt ?? null,
        duration,
        summary.segmentCount,
      ],
    );

    this.persist();
  }

  update(summary: SessionSummary): void {
    const duration = summary.endedAt
      ? Math.max(0, new Date(summary.endedAt).getTime() - new Date(summary.startedAt).getTime())
      : null;

    this.db.run(
      `UPDATE sessions SET
         title = ?,
         mode = ?,
         source = ?,
         started_at = ?,
         ended_at = ?,
         duration_ms = ?,
         segment_count = ?
       WHERE id = ?;`,
      [
        summary.title,
        summary.mode,
        summary.source,
        summary.startedAt,
        summary.endedAt ?? null,
        duration,
        summary.segmentCount,
        summary.id,
      ],
    );

    // A live session updates its summary on every final segment; batch those writes.
    this.persist(summary.endedAt !== null);
  }

  upsertSegment(segment: TranscriptSegment): void {
    const speaker = segment.speaker || 'user';

    // If an earlier final segment exists, do not overwrite it with a late interim result
    const checkStmt = this.db.prepare(
      'SELECT is_final FROM transcript_segments WHERE session_id = ? AND id = ?;'
    );
    checkStmt.bind([segment.sessionId, segment.id]);
    if (checkStmt.step()) {
      const isExistingFinal = Boolean(checkStmt.get()[0]);
      checkStmt.free();
      if (isExistingFinal && !segment.isFinal) {
        return;
      }
    } else {
      checkStmt.free();
    }

    this.db.run(
      `INSERT INTO transcript_segments (id, session_id, speaker, start_ms, end_ms, text, is_final)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, id) DO UPDATE SET
         speaker = excluded.speaker,
         start_ms = excluded.start_ms,
         end_ms = excluded.end_ms,
         text = excluded.text,
         is_final = excluded.is_final;`,
      [
        segment.id,
        segment.sessionId,
        speaker,
        segment.startMs,
        segment.endMs ?? null,
        segment.text,
        segment.isFinal ? 1 : 0,
      ],
    );

    this.persist(false);
  }

  upsertSuggestion(suggestion: SuggestionItem): void {
    // Answers to manual questions asked outside a session have no session row; they are not history.
    const exists = this.db.prepare('SELECT 1 FROM sessions WHERE id = ?;');
    exists.bind([suggestion.sessionId]);
    const hasSession = exists.step();
    exists.free();
    if (!hasSession) return;

    const meta: Record<string, unknown> = {};
    for (const key of SUGGESTION_META_KEYS) {
      if (suggestion[key] !== undefined) meta[key] = suggestion[key];
    }

    this.db.run(
      `INSERT INTO suggestions (id, session_id, created_at, type, title, content, question, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         content = excluded.content,
         question = excluded.question,
         meta = excluded.meta;`,
      [
        suggestion.id,
        suggestion.sessionId,
        suggestion.createdAt,
        suggestion.type,
        suggestion.title,
        suggestion.content,
        suggestion.question ?? null,
        JSON.stringify(meta),
      ],
    );

    this.persist(false);
  }

  list(): SessionSummary[] {
    const stmt = this.db.prepare(
      `SELECT id, title, mode, source, started_at, ended_at, segment_count
       FROM sessions
       ORDER BY started_at DESC;`
    );

    const results: SessionSummary[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      results.push({
        id: String(row.id),
        title: String(row.title),
        mode: row.mode as SessionMode,
        source: row.source as SourceKind,
        startedAt: String(row.started_at),
        endedAt: row.ended_at ? String(row.ended_at) : null,
        segmentCount: Number(row.segment_count || 0),
      });
    }
    stmt.free();
    return results;
  }

  get(id: string): SessionDetail | undefined {
    const sessionStmt = this.db.prepare(
      `SELECT id, title, mode, source, started_at, ended_at, segment_count
       FROM sessions
       WHERE id = ?;`
    );
    sessionStmt.bind([id]);

    if (!sessionStmt.step()) {
      sessionStmt.free();
      return undefined;
    }

    const sRow = sessionStmt.getAsObject() as Record<string, unknown>;
    sessionStmt.free();

    const summary: SessionSummary = {
      id: String(sRow.id),
      title: String(sRow.title),
      mode: sRow.mode as SessionMode,
      source: sRow.source as SourceKind,
      startedAt: String(sRow.started_at),
      endedAt: sRow.ended_at ? String(sRow.ended_at) : null,
      segmentCount: Number(sRow.segment_count || 0),
    };

    // Segments in chronological order
    const segStmt = this.db.prepare(
      `SELECT id, session_id, speaker, start_ms, end_ms, text, is_final
       FROM transcript_segments
       WHERE session_id = ?
       ORDER BY start_ms ASC, rowid ASC;`
    );
    segStmt.bind([id]);

    const segments: TranscriptSegment[] = [];
    while (segStmt.step()) {
      const segRow = segStmt.getAsObject() as Record<string, unknown>;
      segments.push({
        id: String(segRow.id),
        sessionId: String(segRow.session_id),
        speaker: (segRow.speaker as SpeakerKind) || 'user',
        startMs: Number(segRow.start_ms),
        endMs: segRow.end_ms !== null && segRow.end_ms !== undefined ? Number(segRow.end_ms) : null,
        text: String(segRow.text),
        isFinal: Boolean(segRow.is_final),
      });
    }
    segStmt.free();

    // AI Suggestions
    const sugStmt = this.db.prepare(
      `SELECT id, session_id, created_at, type, title, content, question, meta
       FROM suggestions
       WHERE session_id = ?
       ORDER BY created_at ASC, rowid ASC;`
    );
    sugStmt.bind([id]);

    const suggestions: SuggestionItem[] = [];
    while (sugStmt.step()) {
      const sugRow = sugStmt.getAsObject() as Record<string, unknown>;
      let meta: Partial<SuggestionItem> = {};
      try {
        const parsed: unknown = JSON.parse(String(sugRow.meta ?? '{}'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const key of SUGGESTION_META_KEYS) {
            const value = (parsed as Record<string, unknown>)[key];
            if (value !== undefined) (meta as Record<string, unknown>)[key] = value;
          }
        }
      } catch {
        meta = {};
      }
      const item: SuggestionItem = {
        ...meta,
        id: String(sugRow.id),
        sessionId: String(sugRow.session_id),
        createdAt: String(sugRow.created_at),
        type: sugRow.type as SuggestionItem['type'],
        title: String(sugRow.title),
        content: String(sugRow.content),
      };
      if (typeof sugRow.question === 'string' && sugRow.question) item.question = sugRow.question;
      suggestions.push(item);
    }
    sugStmt.free();

    return {
      summary,
      segments,
      suggestions,
    };
  }

  delete(id: string): boolean {
    const countBefore = this.list().length;
    // Children are removed explicitly as well as via ON DELETE CASCADE (defence in depth).
    this.db.run('DELETE FROM transcript_segments WHERE session_id = ?;', [id]);
    this.db.run('DELETE FROM suggestions WHERE session_id = ?;', [id]);
    this.db.run('UPDATE library_items SET session_id = NULL WHERE session_id = ?;', [id]);
    this.db.run('DELETE FROM sessions WHERE id = ?;', [id]);
    const changed = this.list().length < countBefore;
    this.persist();
    return changed;
  }

  clear(): number {
    const count = this.list().length;
    this.db.run('DELETE FROM transcript_segments;');
    this.db.run('DELETE FROM suggestions;');
    this.db.run('UPDATE library_items SET session_id = NULL;');
    this.db.run('DELETE FROM sessions;');
    this.persist();
    return count;
  }

  // ───────────────────────────── Search ─────────────────────────────

  /** Literal, case-insensitive search over finalized transcript text. Newest sessions first. */
  searchTranscripts(query: string, limit = 100): TranscriptSearchHit[] {
    const stmt = this.db.prepare(
      `SELECT t.session_id, s.title, s.started_at, t.id, t.speaker, t.start_ms, t.text
       FROM transcript_segments t JOIN sessions s ON s.id = t.session_id
       WHERE t.is_final = 1 AND t.text LIKE ? ESCAPE '\\'
       ORDER BY s.started_at DESC, t.start_ms ASC
       LIMIT ?;`,
    );
    stmt.bind([`%${escapeLike(query)}%`, Math.max(1, Math.min(500, limit))]);
    const hits: TranscriptSearchHit[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, unknown>;
      hits.push({
        sessionId: String(r.session_id),
        sessionTitle: String(r.title),
        startedAt: String(r.started_at),
        segmentId: String(r.id),
        speaker: (r.speaker as SpeakerKind) || 'user',
        startMs: Number(r.start_ms),
        text: String(r.text),
      });
    }
    stmt.free();
    return hits;
  }

  // ───────────────────────────── Library ─────────────────────────────

  private rowToLibraryItem(r: Record<string, unknown>): LibraryItem {
    let tags: string[] = [];
    try {
      const parsed: unknown = JSON.parse(String(r.tags ?? '[]'));
      if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string');
    } catch {
      tags = [];
    }
    return {
      id: String(r.id),
      kind: r.kind as LibraryKind,
      title: String(r.title),
      content: String(r.content),
      tags,
      sessionId: typeof r.session_id === 'string' ? r.session_id : null,
      question: typeof r.question === 'string' ? r.question : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  listLibrary(query: LibraryQuery = {}): LibraryItem[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (query.kind) {
      where.push('kind = ?');
      params.push(query.kind);
    }
    if (query.sessionId) {
      where.push('session_id = ?');
      params.push(query.sessionId);
    }
    if (query.search) {
      const like = `%${escapeLike(query.search)}%`;
      where.push("(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR question LIKE ? ESCAPE '\\')");
      params.push(like, like, like, like);
    }
    const stmt = this.db.prepare(
      `SELECT id, kind, title, content, tags, session_id, question, created_at, updated_at
       FROM library_items ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY updated_at DESC, rowid DESC LIMIT 500;`,
    );
    stmt.bind(params);
    const items: LibraryItem[] = [];
    while (stmt.step()) items.push(this.rowToLibraryItem(stmt.getAsObject() as Record<string, unknown>));
    stmt.free();
    return items;
  }

  getLibraryItem(id: string): LibraryItem | undefined {
    const stmt = this.db.prepare(
      'SELECT id, kind, title, content, tags, session_id, question, created_at, updated_at FROM library_items WHERE id = ?;',
    );
    stmt.bind([id]);
    const item = stmt.step() ? this.rowToLibraryItem(stmt.getAsObject() as Record<string, unknown>) : undefined;
    stmt.free();
    return item;
  }

  saveLibraryItem(request: SaveLibraryItemRequest, now: string = new Date().toISOString()): LibraryItem {
    const existing = request.id ? this.getLibraryItem(request.id) : undefined;
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
    this.db.run(
      `INSERT INTO library_items (id, kind, title, content, tags, session_id, question, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind, title = excluded.title, content = excluded.content, tags = excluded.tags,
         session_id = excluded.session_id, question = excluded.question, updated_at = excluded.updated_at;`,
      [item.id, item.kind, item.title, item.content, JSON.stringify(item.tags), item.sessionId, item.question, item.createdAt, item.updatedAt],
    );
    this.persist();
    return item;
  }

  deleteLibraryItem(id: string): boolean {
    const existed = this.getLibraryItem(id) !== undefined;
    if (existed) {
      this.db.run('DELETE FROM library_items WHERE id = ?;', [id]);
      this.persist();
    }
    return existed;
  }

  clearLibrary(): number {
    const res = this.db.exec('SELECT count(*) FROM library_items;');
    const count = Number(res[0]?.values?.[0]?.[0] ?? 0);
    this.db.run('DELETE FROM library_items;');
    this.persist();
    return count;
  }

  /** Path of the on-disk database (null when running purely in memory). */
  getFilePath(): string | null {
    return this.filePath;
  }

  flush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.persist(true);
  }

  close(): void {
    this.flush();
    this.db.close();
  }

  private persist(immediate = true): void {
    if (!this.filePath) return;

    this.hasPendingChanges = true;

    if (!immediate) {
      if (this.debounceTimer) return;
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.executePersist();
      }, 300);
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.executePersist();
  }

  private executePersist(): void {
    if (!this.filePath || this.isPersisting || !this.hasPendingChanges) return;

    this.isPersisting = true;
    this.hasPendingChanges = false;

    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = this.db.export();
      // sql.js closes and reopens the database inside export(), which resets every PRAGMA.
      // Without this line cascade deletes silently stop working after the first save.
      this.db.run('PRAGMA foreign_keys = ON;');
      const buffer = Buffer.from(data);
      const tmpPath = `${this.filePath}.tmp`;

      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, this.filePath);

      // Maintain valid crash-safe backup copy
      const bakPath = `${this.filePath}.bak`;
      try {
        fs.copyFileSync(this.filePath, bakPath);
      } catch {}
    } catch (err) {
      console.error('[SqliteSessionRepository] Failed to write database to disk', err);
    } finally {
      this.isPersisting = false;
      // If new writes arrived while exporting/writing, immediately persist the updated state
      if (this.hasPendingChanges) {
        this.executePersist();
      }
    }
  }
}

