import test from 'node:test';
import assert from 'node:assert/strict';
import { applySegment } from '@shared/transcript';
import type { TranscriptSegment } from '@shared/types';

const seg = (id: string, text: string, isFinal: boolean, startMs = 0): TranscriptSegment => ({
  id,
  sessionId: 's1',
  speaker: 'user',
  startMs,
  endMs: isFinal ? startMs + 1000 : null,
  text,
  isFinal,
});

test('appends a new segment without mutating the input', () => {
  const list: TranscriptSegment[] = [];
  const next = applySegment(list, seg('a', 'hello', false));
  assert.equal(list.length, 0);
  assert.deepEqual(next.map((s) => s.text), ['hello']);
});

test('refines an interim segment in place', () => {
  let list: TranscriptSegment[] = [];
  list = applySegment(list, seg('a', 'hello', false));
  list = applySegment(list, seg('a', 'hello there', false));
  list = applySegment(list, seg('a', 'hello there world', true));
  assert.equal(list.length, 1);
  assert.equal(list[0]?.text, 'hello there world');
  assert.equal(list[0]?.isFinal, true);
});

test('ignores a late interim result after the segment is final', () => {
  const finalList = applySegment([], seg('a', 'done', true));
  const after = applySegment(finalList, seg('a', 'do', false));
  assert.equal(after, finalList);
  assert.equal(after[0]?.text, 'done');
});

test('allows a final correction to replace a final segment', () => {
  const list = applySegment([seg('a', 'their', true)], seg('a', 'there', true));
  assert.equal(list[0]?.text, 'there');
});

test('keeps arrival order across segments', () => {
  let list: TranscriptSegment[] = [];
  list = applySegment(list, seg('a', 'one', true, 0));
  list = applySegment(list, seg('b', 'two', false, 2000));
  list = applySegment(list, seg('a', 'one!', true, 0));
  assert.deepEqual(list.map((s) => s.id), ['a', 'b']);
});
