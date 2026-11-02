import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';
import type {
  SessionDetail,
  SessionMode,
  SessionSummary,
  SourceKind,
  SuggestionItem,
  TranscriptSegment,
} from '@shared/types';
import type { SessionRepository } from './sessionRepository';

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
];

export class SqliteSessionRepository implements SessionRepository {
  private db: SqlJsDatabase;
  private readonly filePath: string | null;
  private isPersisting = false;

  private constructor(db: SqlJsDatabase, filePath: string | null) {
    this.db = db;
    this.filePath = filePath;
  }

  static async create(options: SqliteRepositoryOptions = {}): Promise<SqliteSessionRepository> {
    const SQL = await initSqlJs();
    const filePath = options.filePath ?? null;

    let db: SqlJsDatabase;

    if (filePath && fs.existsSync(filePath)) {
      try {
        const fileBuffer = fs.readFileSync(filePath);
        db = new SQL.Database(fileBuffer);
        // Verify database integrity
        db.exec('PRAGMA quick_check;');
      } catch (err) {
        console.warn(`[SqliteSessionRepository] Corrupted database detected at ${filePath}. Creating backup.`, err);
        try {
          const backupPath = `${filePath}.corrupt.${Date.now()}`;
          fs.renameSync(filePath, backupPath);
        } catch {}
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }

    const repository = new SqliteSessionRepository(db, filePath);
    repository.initialize();
    return repository;
  }

  private initialize(): void {
    // Enforce foreign key constraints for cascade deletion
    this.db.run('PRAGMA foreign_keys = ON;');

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

    this.persist();
  }

  upsertSegment(segment: TranscriptSegment): void {
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
      `INSERT INTO transcript_segments (id, session_id, start_ms, end_ms, text, is_final)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, id) DO UPDATE SET
         start_ms = excluded.start_ms,
         end_ms = excluded.end_ms,
         text = excluded.text,
         is_final = excluded.is_final;`,
      [
        segment.id,
        segment.sessionId,
        segment.startMs,
        segment.endMs ?? null,
        segment.text,
        segment.isFinal ? 1 : 0,
      ],
    );

    this.persist();
  }

  upsertSuggestion(suggestion: SuggestionItem): void {
    this.db.run(
      `INSERT INTO suggestions (id, session_id, created_at, type, title, content)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         content = excluded.content;`,
      [
        suggestion.id,
        suggestion.sessionId,
        suggestion.createdAt,
        suggestion.type,
        suggestion.title,
        suggestion.content,
      ],
    );

    this.persist();
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
      `SELECT id, session_id, start_ms, end_ms, text, is_final
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
        startMs: Number(segRow.start_ms),
        endMs: segRow.end_ms !== null && segRow.end_ms !== undefined ? Number(segRow.end_ms) : null,
        text: String(segRow.text),
        isFinal: Boolean(segRow.is_final),
      });
    }
    segStmt.free();

    // AI Suggestions
    const sugStmt = this.db.prepare(
      `SELECT id, session_id, created_at, type, title, content
       FROM suggestions
       WHERE session_id = ?
       ORDER BY created_at ASC, rowid ASC;`
    );
    sugStmt.bind([id]);

    const suggestions: SuggestionItem[] = [];
    while (sugStmt.step()) {
      const sugRow = sugStmt.getAsObject() as Record<string, unknown>;
      suggestions.push({
        id: String(sugRow.id),
        sessionId: String(sugRow.session_id),
        createdAt: String(sugRow.created_at),
        type: sugRow.type as SuggestionItem['type'],
        title: String(sugRow.title),
        content: String(sugRow.content),
      });
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
    this.db.run('DELETE FROM sessions WHERE id = ?;', [id]);
    const changed = this.list().length < countBefore;
    if (changed) {
      this.persist();
    }
    return changed;
  }

  clear(): number {
    const count = this.list().length;
    this.db.run('DELETE FROM sessions;');
    this.persist();
    return count;
  }

  close(): void {
    this.persist();
    this.db.close();
  }

  private persist(): void {
    if (!this.filePath || this.isPersisting) return;

    this.isPersisting = true;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = this.db.export();
      const buffer = Buffer.from(data);
      const tmpPath = `${this.filePath}.tmp`;

      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error('[SqliteSessionRepository] Failed to write database to disk', err);
    } finally {
      this.isPersisting = false;
    }
  }
}
