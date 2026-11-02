import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionService } from '../src/main/services/sessionService';
import { InMemorySessionRepository } from '../src/main/services/sessionRepository';
import type { TranscriptSource } from '../src/main/services/transcriptSource';
import type { AppError, RawSegment, SessionEvent } from '@shared/types';

class FakeSource implements TranscriptSource {
  readonly kind = 'microphone' as const;
  emit: ((s: RawSegment) => void) | undefined;
  raiseError: ((e: AppError) => void) | undefined;
  stopped = 0;
  failStart: Error | undefined;
  failStop = false;

  async start(onSegment: (s: RawSegment) => void, onError: (e: AppError) => void): Promise<void> {
    if (this.failStart) throw this.failStart;
    this.emit = onSegment;
    this.raiseError = onError;
  }
  async stop(): Promise<void> {
    this.stopped += 1;
    if (this.failStop) throw new Error('device busy');
  }
}

function setup(configure?: (s: FakeSource) => void) {
  const source = new FakeSource();
  configure?.(source);
  let n = 0;
  let t = Date.parse('2026-03-01T09:00:00.000Z');
  const service = new SessionService({
    repository: new InMemorySessionRepository(),
    createSource: () => source,
    now: () => new Date((t += 60_000)),
    newId: () => `s${++n}`,
  });
  const events: SessionEvent[] = [];
  service.subscribe((e) => events.push(e));
  return { service, source, events };
}

const raw = (id: string, text: string, isFinal: boolean): RawSegment => ({
  id,
  speaker: 'user',
  text,
  isFinal,
  startMs: 0,
  endMs: isFinal ? 500 : null,
});

test('start moves idle -> starting -> active and reports the session', async () => {
  const { service, events } = setup();
  const r = await service.start({ mode: 'mock-interview' });
  assert.ok(r.ok);
  assert.equal(r.value.status, 'active');
  assert.equal(r.value.activeSession?.title, 'Mock interview');
  const statuses = events.flatMap((e) => (e.type === 'status' ? [e.snapshot.status] : []));
  assert.deepEqual(statuses, ['starting', 'active']);
});

test('uses the custom title when given', async () => {
  const { service } = setup();
  const r = await service.start({ mode: 'study', title: 'Networking revision' });
  assert.ok(r.ok);
  assert.equal(r.value.activeSession?.title, 'Networking revision');
});

test('a second start is rejected, even before the first has finished starting', async () => {
  const { service } = setup();
  const [a, b] = await Promise.all([
    service.start({ mode: 'meeting' }),
    service.start({ mode: 'meeting' }),
  ]);
  assert.ok(a.ok);
  assert.ok(!b.ok);
  assert.equal(b.error.code, 'BUSY');
});

test('interim then final segments are stored once and counted once', async () => {
  const { service, source } = setup();
  await service.start({ mode: 'meeting' });
  source.emit?.(raw('a', 'hel', false));
  source.emit?.(raw('a', 'hello world', true));
  source.emit?.(raw('a', 'hello world', true)); // duplicate final
  source.emit?.(raw('b', 'next', false));
  const stopped = await service.stop();
  assert.ok(stopped.ok);
  assert.equal(stopped.value.segmentCount, 1);
  const detail = service.getSession(stopped.value.id);
  assert.ok(detail.ok);
  assert.deepEqual(detail.value.segments.map((s) => [s.id, s.text, s.isFinal]), [
    ['a', 'hello world', true],
    ['b', 'next', false],
  ]);
  assert.ok(detail.value.segments.every((s) => s.sessionId === stopped.value.id));
});

test('segments emitted after stop are ignored', async () => {
  const { service, source, events } = setup();
  await service.start({ mode: 'meeting' });
  const emit = source.emit;
  const stopped = await service.stop();
  assert.ok(stopped.ok);
  const before = events.length;
  emit?.(raw('late', 'too late', true));
  assert.equal(events.length, before);
  const detail = service.getSession(stopped.value.id);
  assert.ok(detail.ok);
  assert.equal(detail.value.segments.length, 0);
});

test('stop releases the source, sets endedAt, and returns to idle', async () => {
  const { service, source } = setup();
  await service.start({ mode: 'meeting' });
  const r = await service.stop();
  assert.ok(r.ok);
  assert.equal(source.stopped, 1);
  assert.ok(r.value.endedAt && r.value.endedAt > r.value.startedAt);
  assert.deepEqual(service.getSnapshot(), { status: 'idle', activeSession: null });
});

test('stop without a session is a clear error', async () => {
  const { service } = setup();
  const r = await service.stop();
  assert.ok(!r.ok);
  assert.equal(r.error.code, 'NO_ACTIVE_SESSION');
});

test('a source that fails to start leaves no session behind', async () => {
  const { service, events } = setup((s) => {
    s.failStart = new Error('Microphone permission was denied.');
  });
  const r = await service.start({ mode: 'meeting' });
  assert.ok(!r.ok);
  assert.equal(r.error.code, 'SOURCE_FAILED');
  assert.equal(r.error.message, 'Microphone permission was denied.');
  assert.deepEqual(service.getSnapshot(), { status: 'idle', activeSession: null });
  assert.equal(service.listSessions().length, 0);
  assert.equal(events.at(-1)?.type, 'status');
});

test('a source that fails to stop still ends the session and reports the problem', async () => {
  const { service, events } = setup((s) => {
    s.failStop = true;
  });
  await service.start({ mode: 'meeting' });
  const r = await service.stop();
  assert.ok(r.ok);
  assert.equal(service.getSnapshot().status, 'idle');
  assert.ok(events.some((e) => e.type === 'error' && e.error.code === 'SOURCE_FAILED'));
});

test('source errors are forwarded as events without ending the session', async () => {
  const { service, source, events } = setup();
  await service.start({ mode: 'meeting' });
  source.raiseError?.({ code: 'SOURCE_FAILED', message: 'Network dropped. Reconnecting.' });
  assert.equal(service.getSnapshot().status, 'active');
  assert.ok(events.some((e) => e.type === 'error'));
});

test('deleting: the active session is protected, finished ones can be removed', async () => {
  const { service } = setup();
  const started = await service.start({ mode: 'meeting' });
  assert.ok(started.ok);
  const id = started.value.activeSession!.id;

  const refused = service.deleteSession(id);
  assert.ok(!refused.ok);
  assert.equal(refused.error.code, 'SESSION_ACTIVE');
  assert.ok(!service.clearHistory().ok);

  await service.stop();
  const removed = service.deleteSession(id);
  assert.ok(removed.ok);
  assert.equal(removed.value.deleted, 1);
  const again = service.deleteSession(id);
  assert.ok(!again.ok);
  assert.equal(again.error.code, 'NOT_FOUND');
});

test('history lists newest first and can be cleared', async () => {
  const { service } = setup();
  await service.start({ mode: 'meeting', title: 'First' });
  await service.stop();
  await service.start({ mode: 'meeting', title: 'Second' });
  await service.stop();
  assert.deepEqual(service.listSessions().map((s) => s.title), ['Second', 'First']);
  const cleared = service.clearHistory();
  assert.ok(cleared.ok);
  assert.equal(cleared.value.deleted, 2);
  assert.equal(service.listSessions().length, 0);
});

test('a throwing listener does not break the session', async () => {
  const { service } = setup();
  service.subscribe(() => {
    throw new Error('window closed');
  });
  const r = await service.start({ mode: 'meeting' });
  assert.ok(r.ok);
});
