import test from 'node:test';
import assert from 'node:assert/strict';
import { CompositeTranscriptSource } from '../src/main/services/compositeTranscriptSource';
import { SettingsService } from '../src/main/services/settingsService';
import type { RawSegment } from '@shared/types';

test('CompositeTranscriptSource: manages both mic and system sources simultaneously', async () => {
  const settingsService = new SettingsService(null, null);
  let time = 2000;
  const clock = () => (time += 100);

  const composite = new CompositeTranscriptSource({
    settingsService,
    clock,
  });

  assert.equal(composite.kind, 'both');

  const segments: RawSegment[] = [];
  await composite.start(
    (seg) => segments.push(seg),
    () => {},
  );

  // Generate loud PCM audio
  const pcm = new Int16Array(1600);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = Math.round(15000 * Math.sin(i / 10));
  }

  // Push mic chunk
  composite.pushAudioChunk('mic', pcm.buffer);

  // Push system chunk
  composite.pushAudioChunk('system', pcm.buffer);

  // Wait for recognizers
  await new Promise((resolve) => setTimeout(resolve, 600));

  assert.ok(segments.length > 0, 'Should have emitted segments');

  const speakers = new Set(segments.map((s) => s.speaker));
  // Verify that speakers include user and/or system based on energy triggers
  assert.ok(speakers.has('user') || speakers.has('system'));

  await composite.stop();
});

