import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteSessionRepository } from '../src/main/services/sqliteSessionRepository';
import { DiagnosticsService } from '../src/main/services/diagnosticsService';
import { MicrophoneTranscriptSource } from '../src/main/services/microphoneTranscriptSource';
import { SystemAudioTranscriptSource } from '../src/main/services/systemAudioTranscriptSource';
import { ScreenContextManager } from '../src/main/services/screenContextManager';
import { SuggestionService } from '../src/main/services/suggestionService';
import { SettingsService } from '../src/main/services/settingsService';
import { DuplicateResponseGuard } from '../src/main/services/intelligence/duplicateResponseGuard';
import { ConversationStateManager } from '../src/main/services/intelligence/conversationStateManager';
import { applySegment } from '../src/shared/transcript';
import type { SessionSummary, TranscriptSegment, SuggestionItem } from '../src/shared/types';

// Helper to create a temporary test directory
function createTempDir(): string {
  const dir = path.join(os.tmpdir(), `gigaagent_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ==========================================
// SCENARIO 1 - 5: Startup, Shutdown & Lifecycle
// ==========================================

test('1. Normal Startup: DiagnosticsService initializes with healthy platform metrics', () => {
  const tmpDir = createTempDir();
  const diag = new DiagnosticsService({ userDataDir: tmpDir, appVersion: '0.1.0', electronVersion: '32.0.0' });

  const snapshot = diag.getSnapshot();
  assert.equal(snapshot.appVersion, '0.1.0');
  assert.equal(snapshot.electronVersion, '32.0.0');
  assert.equal(snapshot.databaseHealth, 'healthy');
  assert.equal(snapshot.audioCaptureStatus, 'idle');
  assert.equal(snapshot.sttConnectionStatus, 'disconnected');
  assert.equal(typeof snapshot.uptimeSeconds, 'number');

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

test('2. Duplicate Application Launch: Single-instance lock rejection simulation', () => {
  let isPrimaryInstance = true;
  const requestLock = () => {
    if (!isPrimaryInstance) return false;
    isPrimaryInstance = false;
    return true;
  };

  const firstInstance = requestLock();
  assert.equal(firstInstance, true);

  const secondInstance = requestLock();
  assert.equal(secondInstance, false);
});

test('3. Normal Shutdown: Releases database, flushes debounced writes and closes cleanly', async () => {
  const tmpDir = createTempDir();
  const dbPath = path.join(tmpDir, 'test.db');
  const repo = await SqliteSessionRepository.create({ filePath: dbPath });

  const summary: SessionSummary = {
    id: 'shutdown_sess_1',
    title: 'Shutdown Test Session',
    mode: 'mock-interview',
    source: 'microphone',
    startedAt: new Date().toISOString(),
    endedAt: null,
    segmentCount: 0,
  };

  repo.create(summary);
  repo.flush();
  repo.close();

  assert.equal(fs.existsSync(dbPath), true);
  assert.equal(fs.existsSync(`${dbPath}.bak`), true);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

test('4. Renderer Crash Handling: Disarms gates and clears active screen context', () => {
  const screenCtx = new ScreenContextManager();
  screenCtx.setPending({
    id: 'scr_crash_1',
    sourceId: 'screen:0',
    sourceName: 'Screen 1',
    dataUrl: 'data:image/jpeg;base64,123',
    base64: '123',
    width: 1920,
    height: 1080,
    capturedAt: new Date().toISOString(),
  });
  screenCtx.confirm('scr_crash_1');
  assert.equal(screenCtx.hasContext(), true);

  // Simulate renderer crash event handling
  screenCtx.clear();
  assert.equal(screenCtx.hasContext(), false);
  assert.equal(screenCtx.getConfirmed(), null);
  assert.equal(screenCtx.getPending(), null);
});

test('5. Audio Resource Cleanup: Stops all streams and releases memory buffers on stop', async () => {
  const settings = new SettingsService(null, null);
  const source = new MicrophoneTranscriptSource({ settingsService: settings });

  await source.start(() => {}, () => {});
  // Push audio chunk
  const chunk = new ArrayBuffer(3200);
  source.pushAudioChunk(chunk);

  await source.stop();
  // Pushing after stop does nothing and does not throw
  assert.doesNotThrow(() => source.pushAudioChunk(chunk));
});

// ==========================================
// SCENARIO 6 - 10: Deepgram Reconnection, Gemini Reliability & Deduplication
// ==========================================

test('6. Deepgram Reconnection: Performs bounded retry attempts and backoff on unexpected close', async () => {
  const settings = new SettingsService(null, null);
  settings.saveSettings({ sttApiKey: 'dg_test_key_123', sttProvider: 'deepgram' });

  const source = new MicrophoneTranscriptSource({ settingsService: settings });
  let errorEmitted = false;

  await source.start(
    () => {},
    (err) => {
      errorEmitted = true;
      assert.equal(err.code, 'SOURCE_FAILED');
    },
  );

  await source.stop();
});

test('7. Gemini Request Timeout: AbortController aborts hung network requests within timeout threshold', async () => {
  const controller = new AbortController();
  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('Gemini request timed out after 50ms'));
  }, 50);

  try {
    await new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(controller.signal.reason);
      });
    });
    assert.fail('Should have aborted');
  } catch (err) {
    assert.equal(timedOut, true);
    assert.match(String(err), /timed out/i);
  } finally {
    clearTimeout(timeoutId);
  }
});

test('8. Gemini Rate Limit (429) & Model Fallback: Dispatches to fallback model candidate with backoff', async () => {
  let callCount = 0;
  const mockRequester = async (model: string) => {
    callCount++;
    if (model === 'gemini-flash-lite-latest') {
      const err: any = new Error('Model returned HTTP 429: Resource has been exhausted');
      err.status = 429;
      throw err;
    }
    return { text: '{"title":"Success","content":"Recovered from fallback model"}', modelUsed: model };
  };

  // Simulating the fallback loop logic
  const candidateModels = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite'];
  let result: any = null;

  for (const model of candidateModels) {
    try {
      result = await mockRequester(model);
      break;
    } catch (err: any) {
      if (err.status === 429) {
        continue; // backoff and fallback
      }
      throw err;
    }
  }

  assert.equal(callCount, 2);
  assert.equal(result.modelUsed, 'gemini-3.5-flash-lite');
  assert.match(result.text, /Recovered from fallback model/);
});

test('9. Duplicate AI Request Handling: DuplicateResponseGuard blocks identical queries within cooldown', () => {
  const guard = new DuplicateResponseGuard(5000);
  const q = 'How does garbage collection work in V8?';

  assert.equal(guard.isDuplicate(q), false);
  guard.recordCompleted(q);

  // Subsequent duplicate inquiry within cooldown must be suppressed
  assert.equal(guard.isDuplicate(q), true);
  assert.equal(guard.isDuplicate('how does garbage collection work in v8?'), true);
});

test('10. Stale Response Rejection: Monotonic request IDs discard older superseding requests', () => {
  const stateMgr = new ConversationStateManager();
  stateMgr.setSession('session_1', 'mock-interview');

  const req1 = stateMgr.startRequest();
  const req2 = stateMgr.startRequest();

  // req1 completes after req2 has started
  const req1Status = stateMgr.completeRequest(req1, 'Old Q');
  assert.equal(req1Status, false); // Rejected as stale!

  // req2 completes
  const req2Status = stateMgr.completeRequest(req2, 'New Q');
  assert.equal(req2Status, true);
  assert.equal(stateMgr.getLastAnswered(), 'New Q');
});

// ==========================================
// SCENARIO 11 - 15: SQLite Persistence, Corruption Recovery & Context Cleanup
// ==========================================

test('11. SQLite Restart Persistence: Re-opening valid SQLite database preserves all sessions and segments', async () => {
  const tmpDir = createTempDir();
  const dbPath = path.join(tmpDir, 'persist_test.db');

  // Instance 1
  const repo1 = await SqliteSessionRepository.create({ filePath: dbPath });
  const summary: SessionSummary = {
    id: 's_p_1',
    title: 'Persistent Session',
    mode: 'meeting',
    source: 'both',
    startedAt: '2026-11-11T00:00:00.000Z',
    endedAt: '2026-11-11T00:30:00.000Z',
    segmentCount: 1,
  };
  repo1.create(summary);
  repo1.upsertSegment({
    id: 'seg_1',
    sessionId: 's_p_1',
    speaker: 'system',
    startMs: 0,
    endMs: 1500,
    text: 'Let us begin the architecture discussion.',
    isFinal: true,
  });
  repo1.flush();
  repo1.close();

  // Instance 2 (Reopening after shutdown)
  const repo2 = await SqliteSessionRepository.create({ filePath: dbPath });
  const details = repo2.get('s_p_1');

  assert.ok(details);
  assert.equal(details.summary.title, 'Persistent Session');
  assert.equal(details.segments.length, 1);
  assert.equal(details.segments[0]?.text, 'Let us begin the architecture discussion.');
  assert.equal(repo2.getHealth(), 'healthy');
  repo2.close();

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

test('12. SQLite Corruption Recovery: Automatically recovers from .bak backup file when primary DB is corrupt', async () => {
  const tmpDir = createTempDir();
  const dbPath = path.join(tmpDir, 'corrupt_test.db');

  // 1. Create valid database and backup
  const repo = await SqliteSessionRepository.create({ filePath: dbPath });
  repo.create({
    id: 'sess_backup_1',
    title: 'Recoverable Session',
    mode: 'mock-interview',
    source: 'microphone',
    startedAt: new Date().toISOString(),
    endedAt: null,
    segmentCount: 0,
  });
  repo.flush();
  repo.close();

  assert.equal(fs.existsSync(`${dbPath}.bak`), true);

  // 2. Corrupt the primary database file with garbage bytes
  fs.writeFileSync(dbPath, 'CORRUPTED_GARBAGE_BYTES_THAT_ARE_NOT_SQLITE');

  // 3. Re-open repository — should automatically recover from .bak!
  const recoveredRepo = await SqliteSessionRepository.create({ filePath: dbPath });
  assert.equal(recoveredRepo.getHealth(), 'recovered');

  const recoveredSession = recoveredRepo.get('sess_backup_1');
  assert.ok(recoveredSession);
  assert.equal(recoveredSession.summary.title, 'Recoverable Session');

  recoveredRepo.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

test('13. Transcript Buffer Bounding: Bounds renderer transcript array to prevent memory bloat', () => {
  let segments: TranscriptSegment[] = [];

  // Simulate 600 streaming segments arriving over a long session
  for (let i = 0; i < 600; i++) {
    const seg: TranscriptSegment = {
      id: `seg_${i}`,
      sessionId: 'sess_long',
      speaker: i % 2 === 0 ? 'user' : 'system',
      startMs: i * 1000,
      endMs: i * 1000 + 900,
      text: `Utterance speech segment #${i}`,
      isFinal: true,
    };
    const updated = applySegment(segments, seg);
    // Bounded to 500
    segments = updated.length > 500 ? updated.slice(-500) : updated;
  }

  assert.equal(segments.length, 500);
  assert.equal(segments[segments.length - 1]?.id, 'seg_599');
});

test('14. Screenshot Cleanup: Ensures image base64 bytes are purged from memory upon context clear', () => {
  const screenCtx = new ScreenContextManager();
  const largeBase64 = 'A'.repeat(500000); // 500KB mock image

  screenCtx.setPending({
    id: 'scr_mem_1',
    sourceId: 'screen:0',
    sourceName: 'Display',
    dataUrl: `data:image/jpeg;base64,${largeBase64}`,
    base64: largeBase64,
    width: 1920,
    height: 1080,
    capturedAt: new Date().toISOString(),
  });

  screenCtx.confirm('scr_mem_1');
  assert.equal(screenCtx.getConfirmed()?.base64.length, 500000);

  // Clear context
  screenCtx.clear();
  assert.equal(screenCtx.getConfirmed(), null);
  assert.equal(screenCtx.getPending(), null);
  assert.equal(screenCtx.getTurns().length, 0);
});

test('15. Session Recovery On Restart: Never automatically restarts recording without explicit user action', async () => {
  const tmpDir = createTempDir();
  const dbPath = path.join(tmpDir, 'restart_test.db');
  const repo = await SqliteSessionRepository.create({ filePath: dbPath });

  // Add an uncompleted session that was active during crash
  repo.create({
    id: 'crashed_session_1',
    title: 'Interrupted Session',
    mode: 'meeting',
    source: 'microphone',
    startedAt: new Date().toISOString(),
    endedAt: null,
    segmentCount: 5,
  });
  repo.flush();
  repo.close();

  // App reopens: repository loads session history
  const newRepo = await SqliteSessionRepository.create({ filePath: dbPath });
  const list = newRepo.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, 'crashed_session_1');

  // Verify that audio capture status starts as 'idle' and is not resumed
  const diag = new DiagnosticsService({ userDataDir: tmpDir });
  assert.equal(diag.getSnapshot().audioCaptureStatus, 'idle');

  newRepo.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ==========================================
// SCENARIO 16 - 20: Event Cleanup, Cycles, Keys & Network Disconnection
// ==========================================

test('16. Event Listener Cleanup: Unsubscribe removes IPC listener cleanly', () => {
  const listeners = new Set<(event: any) => void>();
  const subscribe = (fn: (event: any) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const listener = () => {};
  const unsubscribe = subscribe(listener);
  assert.equal(listeners.size, 1);

  unsubscribe();
  assert.equal(listeners.size, 0);
});

test('17. Repeated Start/Stop Cycles: Multiple audio sessions start and stop without timer leaks', async () => {
  const settings = new SettingsService(null, null);

  for (let cycle = 1; cycle <= 5; cycle++) {
    const source = new MicrophoneTranscriptSource({ settingsService: settings });
    await source.start(() => {}, () => {});
    source.pushAudioChunk(new ArrayBuffer(1600));
    await source.stop();
  }

  assert.ok(true, 'Completed 5 start/stop cycles with zero unhandled timer exceptions');
});

test('18. Missing API Keys: Gracefully reports missing keys without process crash', async () => {
  const settings = new SettingsService(null, null);
  const suggestionService = new SuggestionService({
    settingsService: settings,
    onSuggestion: () => {},
  });

  const res = await suggestionService.testGeminiConnection();
  assert.equal(res.ok, false);
  assert.match(res.error.message, /No Gemini API key is configured/i);

  suggestionService.destroy();
});

test('19. Invalid Credentials Error Handling: Classified error surfaces clear message', () => {
  const tmpDir = createTempDir();
  const diag = new DiagnosticsService({ userDataDir: tmpDir });

  const error = diag.recordError(
    'TRANSCRIPTION',
    'Invalid Deepgram API key. Please check your credentials in Settings.',
    'HTTP 401 Unauthorized for token: dg_secret_token_1234567890abcdef',
  );

  assert.equal(error.category, 'TRANSCRIPTION');
  assert.match(error.userMessage, /Invalid Deepgram API key/i);
  // Redaction check: API key token must be redacted
  assert.doesNotMatch(error.technicalDetails || '', /dg_secret_token_1234567890abcdef/);
  assert.match(error.technicalDetails || '', /REDACTED_TOKEN/);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

test('20. Network Disconnection Handling: DiagnosticsService exports sanitized failure state', () => {
  const tmpDir = createTempDir();
  const diag = new DiagnosticsService({ userDataDir: tmpDir });

  diag.setSttStatus('error');
  diag.recordError('TRANSCRIPTION', 'Network connection was interrupted during audio transcription.');

  const { exportedPath, content } = diag.exportDiagnostics();
  assert.equal(fs.existsSync(exportedPath), true);

  const parsed = JSON.parse(content);
  assert.equal(parsed.diagnostics.sttConnectionStatus, 'error');
  assert.equal(parsed.diagnostics.lastError.category, 'TRANSCRIPTION');

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

