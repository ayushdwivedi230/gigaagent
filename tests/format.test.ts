import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, sessionDurationMs } from '@shared/format';

test('formatClock pads minutes and seconds', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(3_000), '00:03');
  assert.equal(formatClock(83_000), '01:23');
});

test('formatClock shows hours only when needed', () => {
  assert.equal(formatClock(3_599_000), '59:59');
  assert.equal(formatClock(3_723_000), '1:02:03');
});

test('formatClock tolerates bad input', () => {
  assert.equal(formatClock(-5_000), '00:00');
  assert.equal(formatClock(Number.NaN), '00:00');
  assert.equal(formatClock(999), '00:00');
});

test('sessionDurationMs', () => {
  assert.equal(sessionDurationMs('2026-01-01T10:00:00Z', null), null);
  assert.equal(sessionDurationMs('2026-01-01T10:00:00Z', '2026-01-01T10:01:30Z'), 90_000);
  assert.equal(sessionDurationMs('2026-01-01T10:00:00Z', '2025-01-01T10:00:00Z'), 0);
  assert.equal(sessionDurationMs('nope', 'also-nope'), null);
});
