import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TITLE_LENGTH, parseSessionId, parseStartRequest } from '@shared/validation';

test('accepts a valid request and normalises the title', () => {
  const r = parseStartRequest({ mode: 'meeting', title: '  Weekly   sync  ' });
  assert.ok(r.ok);
  assert.deepEqual(r.value, { mode: 'meeting', title: 'Weekly sync' });
});

test('treats a blank title as absent', () => {
  const r = parseStartRequest({ mode: 'study', title: '   ' });
  assert.ok(r.ok);
  assert.equal(r.value.title, undefined);
});

test('rejects non-objects, bad modes and bad titles', () => {
  for (const bad of [null, undefined, 'x', 5, {}, { mode: 'party' }, { mode: 7 }]) {
    const r = parseStartRequest(bad);
    assert.ok(!r.ok, `expected rejection for ${JSON.stringify(bad)}`);
    assert.equal(r.error.code, 'INVALID_REQUEST');
  }
  assert.ok(!parseStartRequest({ mode: 'meeting', title: 42 }).ok);
  assert.ok(!parseStartRequest({ mode: 'meeting', title: 'x'.repeat(MAX_TITLE_LENGTH + 1) }).ok);
});

test('session ids must look like uuids / simple tokens', () => {
  assert.ok(parseSessionId('3f2b1c9e-1111-4222-8333-444455556666').ok);
  for (const bad of ['', '../etc/passwd', 'a b', 'x'.repeat(65), 12, null]) {
    assert.ok(!parseSessionId(bad).ok);
  }
});
