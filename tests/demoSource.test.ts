import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoTranscriptSource } from '../src/main/services/demoTranscriptSource';
import type { RawSegment } from '@shared/types';

test('emits interim results that end in one final segment, then stops cleanly', async () => {
  const source = new DemoTranscriptSource({ tickMs: 5, pauseMs: 10, firstLineDelayMs: 5 });
  const seen: RawSegment[] = [];
  await source.start((s) => seen.push(s), () => {});
  await new Promise((resolve) => setTimeout(resolve, 400));
  await source.stop();
  const count = seen.length;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(seen.length, count, 'no emissions after stop');
  assert.ok(seen.some((s) => !s.isFinal), 'has interim results');
  assert.ok(seen.some((s) => s.isFinal), 'has a final result');
  const first = seen.filter((s) => s.id === seen[0]?.id);
  assert.ok(first.every((s, i) => i === 0 || s.text.length >= (first[i - 1]?.text.length ?? 0)));
});
