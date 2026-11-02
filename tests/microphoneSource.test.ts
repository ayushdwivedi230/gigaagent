import test from 'node:test';
import assert from 'node:assert/strict';
import { MicrophoneTranscriptSource } from '../src/main/services/microphoneTranscriptSource';
import { SettingsService } from '../src/main/services/settingsService';
import type { AppError, RawSegment } from '@shared/types';

test('MicrophoneTranscriptSource starts and processes voice audio chunks', async () => {
  const settingsService = new SettingsService(null, null);
  settingsService.saveSettings({ sttProvider: 'mock' });

  const segments: RawSegment[] = [];
  const errors: AppError[] = [];

  const source = new MicrophoneTranscriptSource({
    settingsService,
  });

  await source.start(
    (seg) => segments.push(seg),
    (err) => errors.push(err),
  );

  assert.equal(source.kind, 'microphone');

  // Create a 100ms 16kHz PCM audio chunk with sound energy
  const samples = new Int16Array(1600);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(Math.sin(i / 5) * 16000);
  }

  // Push chunk into source
  source.pushAudioChunk(samples.buffer);

  // Allow energy processor and recognizer loop to register
  await new Promise((resolve) => setTimeout(resolve, 600));

  assert.ok(segments.length > 0);
  assert.ok(segments[0]?.text.includes('[Mic Capture]'));

  await source.stop();
});

