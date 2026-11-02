import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteSessionRepository } from '../src/main/services/sqliteSessionRepository';
import type { SessionSummary, SuggestionItem, TranscriptSegment } from '@shared/types';

test('SqliteSessionRepository: initializes database and runs migrations in memory', async () => {
  const repo = await SqliteSessionRepository.create({ filePath: null });
  const list = repo.list();
  assert.equal(list.length, 0);
  repo.close();
});

test('SqliteSessionRepository: creates, retrieves, and updates sessions', async () => {
  const repo = await SqliteSessionRepository.create({ filePath: null });

  const summary: SessionSummary = {
    id: 'test_session_1',
    title: 'Design Review',
    mode: 'meeting',
    source: 'microphone',
    startedAt: '2026-11-02T10:00:00.000Z',
    endedAt: null,
    segmentCount: 0,
  };

  repo.create(summary);

  const list = repo.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, 'test_session_1');
  assert.equal(list[0]?.title, 'Design Review');

  // Update session
  summary.endedAt = '2026-11-02T10:30:00.000Z';
  summary.segmentCount = 5;
  repo.update(summary);

  const updated = repo.get('test_session_1');
  assert.ok(updated);
  assert.equal(updated.summary.endedAt, '2026-11-02T10:30:00.000Z');
  assert.equal(updated.summary.segmentCount, 5);

  repo.close();
});

test('SqliteSessionRepository: application restart persistence (file-backed)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'giga-sqlite-test-'));
  const dbPath = path.join(tmpDir, 'sessions.db');

  // 1. First instance: create session and add segments & suggestions
  const repo1 = await SqliteSessionRepository.create({ filePath: dbPath });

  repo1.create({
    id: 's_persisted',
    title: 'Roadmap Planning',
    mode: 'meeting',
    source: 'microphone',
    startedAt: '2026-11-02T11:00:00.000Z',
    endedAt: '2026-11-02T11:45:00.000Z',
    segmentCount: 2,
  });

  repo1.upsertSegment({
    id: 'seg_1',
    sessionId: 's_persisted',
    speaker: 'user',
    startMs: 0,
    endMs: 2500,
    text: 'Let us discuss Q4 priorities.',
    isFinal: true,
  });

  repo1.upsertSuggestion({
    id: 'sug_1',
    sessionId: 's_persisted',
    createdAt: '2026-11-02T11:01:00.000Z',
    type: 'action_item',
    title: 'Finalize Q4 priorities',
    content: 'Review and confirm ownership for key deliverables.',
  });

  repo1.close();

  // Verify file was written to disk
  assert.ok(fs.existsSync(dbPath));
  assert.ok(fs.statSync(dbPath).size > 0);

  // 2. Second instance (simulating app restart): load from same file
  const repo2 = await SqliteSessionRepository.create({ filePath: dbPath });

  const list = repo2.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, 's_persisted');
  assert.equal(list[0]?.title, 'Roadmap Planning');

  const detail = repo2.get('s_persisted');
  assert.ok(detail);
  assert.equal(detail.segments.length, 1);
  assert.equal(detail.segments[0]?.text, 'Let us discuss Q4 priorities.');
  assert.equal(detail.suggestions?.length, 1);
  assert.equal(detail.suggestions?.[0]?.title, 'Finalize Q4 priorities');

  repo2.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('SqliteSessionRepository: preserves chronological transcript ordering and interim-to-final merge', async () => {
  const repo = await SqliteSessionRepository.create({ filePath: null });

  repo.create({
    id: 's_order',
    title: 'Ordering Test',
    mode: 'study',
    source: 'demo',
    startedAt: '2026-11-02T12:00:00.000Z',
    endedAt: null,
    segmentCount: 0,
  });

  // Insert out of chronological order
  repo.upsertSegment({
    id: 'seg_later',
    sessionId: 's_order',
    speaker: 'system',
    startMs: 5000,
    endMs: 7000,
    text: 'Second spoken thought.',
    isFinal: true,
  });

  repo.upsertSegment({
    id: 'seg_earlier',
    sessionId: 's_order',
    speaker: 'user',
    startMs: 1000,
    endMs: 3000,
    text: 'First spoken thought.',
    isFinal: true,
  });

  // Interim refinement
  repo.upsertSegment({
    id: 'seg_interim',
    sessionId: 's_order',
    speaker: 'system',
    startMs: 8000,
    endMs: null,
    text: 'Third thought partial',
    isFinal: false,
  });

  repo.upsertSegment({
    id: 'seg_interim',
    sessionId: 's_order',
    speaker: 'system',
    startMs: 8000,
    endMs: 9500,
    text: 'Third thought finalized.',
    isFinal: true,
  });

  // Late interim should NOT overwrite a final segment
  repo.upsertSegment({
    id: 'seg_interim',
    sessionId: 's_order',
    speaker: 'system',
    startMs: 8000,
    endMs: null,
    text: 'Late interim garbage',
    isFinal: false,
  });

  const detail = repo.get('s_order');
  assert.ok(detail);
  assert.equal(detail.segments.length, 3);
  assert.equal(detail.segments[0]?.id, 'seg_earlier');
  assert.equal(detail.segments[1]?.id, 'seg_later');
  assert.equal(detail.segments[2]?.id, 'seg_interim');
  assert.equal(detail.segments[2]?.text, 'Third thought finalized.');

  repo.close();
});

test('SqliteSessionRepository: session deletion cascades to segments and suggestions', async () => {
  const repo = await SqliteSessionRepository.create({ filePath: null });

  repo.create({
    id: 's_delete',
    title: 'Temporary Session',
    mode: 'meeting',
    source: 'microphone',
    startedAt: '2026-11-02T13:00:00.000Z',
    endedAt: null,
    segmentCount: 1,
  });

  repo.upsertSegment({
    id: 'seg_del_1',
    sessionId: 's_delete',
    speaker: 'user',
    startMs: 0,
    endMs: 1000,
    text: 'Will be deleted.',
    isFinal: true,
  });

  repo.upsertSuggestion({
    id: 'sug_del_1',
    sessionId: 's_delete',
    createdAt: '2026-11-02T13:00:05.000Z',
    type: 'key_point',
    title: 'Key point to delete',
    content: 'Content to delete',
  });

  assert.equal(repo.list().length, 1);
  assert.ok(repo.get('s_delete'));

  // Delete session
  const deleted = repo.delete('s_delete');
  assert.equal(deleted, true);
  assert.equal(repo.list().length, 0);
  assert.equal(repo.get('s_delete'), undefined);

  // Deleting nonexistent session returns false
  assert.equal(repo.delete('s_delete'), false);

  repo.close();
});

test('SqliteSessionRepository: clear removes all sessions and records', async () => {
  const repo = await SqliteSessionRepository.create({ filePath: null });

  repo.create({
    id: 's1',
    title: 'Session 1',
    mode: 'meeting',
    source: 'demo',
    startedAt: '2026-11-02T14:00:00.000Z',
    endedAt: null,
    segmentCount: 0,
  });

  repo.create({
    id: 's2',
    title: 'Session 2',
    mode: 'study',
    source: 'microphone',
    startedAt: '2026-11-02T14:30:00.000Z',
    endedAt: null,
    segmentCount: 0,
  });

  assert.equal(repo.list().length, 2);

  const clearedCount = repo.clear();
  assert.equal(clearedCount, 2);
  assert.equal(repo.list().length, 0);

  repo.close();
});

test('SqliteSessionRepository: corruption recovery backs up corrupted file and creates fresh db', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'giga-corrupt-test-'));
  const dbPath = path.join(tmpDir, 'corrupted_sessions.db');

  // Write garbage bytes simulating database corruption
  fs.writeFileSync(dbPath, 'NOT A VALID SQLITE DATABASE HEADER GIBBERISH 123456');

  // Should not throw, should back up and recover cleanly
  const repo = await SqliteSessionRepository.create({ filePath: dbPath });

  assert.equal(repo.list().length, 0);

  // Verify backup file exists
  const files = fs.readdirSync(tmpDir);
  const backupFound = files.some((f) => f.includes('corrupt'));
  assert.ok(backupFound, 'Expected a backup file with .corrupt extension');

  repo.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('SqliteSessionRepository: Migration 2 applies speaker column and distinguishes user vs system speakers', async () => {
  const repo = await SqliteSessionRepository.create({ filePath: null });

  repo.create({
    id: 's_dual_speakers',
    title: 'Dual Speaker Session',
    mode: 'meeting',
    source: 'both',
    startedAt: '2026-11-02T15:00:00.000Z',
    endedAt: null,
    segmentCount: 0,
  });

  repo.upsertSegment({
    id: 'seg_user_1',
    sessionId: 's_dual_speakers',
    speaker: 'user',
    startMs: 1000,
    endMs: 3000,
    text: 'I have a question about the deployment pipeline.',
    isFinal: true,
  });

  repo.upsertSegment({
    id: 'seg_sys_1',
    sessionId: 's_dual_speakers',
    speaker: 'system',
    startMs: 4000,
    endMs: 6500,
    text: 'The deployment pipeline runs automated canary checks before promotion.',
    isFinal: true,
  });

  const detail = repo.get('s_dual_speakers');
  assert.ok(detail);
  assert.equal(detail.segments.length, 2);
  assert.equal(detail.segments[0]?.speaker, 'user');
  assert.equal(detail.segments[0]?.text, 'I have a question about the deployment pipeline.');
  assert.equal(detail.segments[1]?.speaker, 'system');
  assert.equal(detail.segments[1]?.text, 'The deployment pipeline runs automated canary checks before promotion.');

  repo.close();
});


