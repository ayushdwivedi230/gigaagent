import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemAudioTranscriptSource } from '../src/main/services/systemAudioTranscriptSource';
import { SettingsService } from '../src/main/services/settingsService';
import type { RawSegment } from '@shared/types';

test('SystemAudioTranscriptSource: starts in mock/offline mode, tags segments with speaker=system, and cleans up', async () => {
  const settingsService = new SettingsService(null, null);
  let time = 1000;
  const clock = () => (time += 100);

  const source = new SystemAudioTranscriptSource({
    settingsService,
    clock,
  });

  assert.equal(source.kind, 'system');

  const segments: RawSegment[] = [];
  await source.start(
    (seg) => segments.push(seg),
    () => {},
  );

  // Send an energetic PCM chunk (simulated speech energy)
  const pcm = new Int16Array(1600); // 100ms of 16kHz audio
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = Math.round(15000 * Math.sin(i / 10)); // Loud speech amplitude
  }

  source.pushAudioChunk(pcm.buffer);

  // Wait for mock recognizer to emit
  await new Promise((resolve) => setTimeout(resolve, 600));

  assert.ok(segments.length > 0, 'Should have emitted segments from mock speech detection');
  for (const seg of segments) {
    assert.equal(seg.speaker, 'system', 'Every emitted segment must have speaker: system');
  }

  await source.stop();
});
