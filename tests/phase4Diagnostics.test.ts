import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemAudioGate } from '../src/main/services/systemAudioGate';
import { SuggestionService } from '../src/main/services/suggestionService';
import { SettingsService } from '../src/main/services/settingsService';
import type { SuggestionItem, TranscriptSegment } from '@shared/types';

test('SystemAudioGate enforces mandatory security checks and auto-disarms', () => {
  const gate = new SystemAudioGate(100);
  assert.equal(gate.isArmed(), false);

  gate.arm();
  assert.equal(gate.isArmed(), true);

  const mockWindow = {
    isDestroyed: () => false,
    webContents: {
      mainFrame: { id: 1 },
    },
  } as any;

  // Rejects unauthenticated frame
  const badFrame = gate.validateRequest(
    {
      frame: { top: { id: 999 } },
      securityOrigin: 'http://localhost:5173',
      userGesture: true,
      videoRequested: true,
      audioRequested: true,
    },
    mockWindow,
  );
  assert.equal(badFrame.valid, false);

  // Valid request passes and immediately disarms the gate
  const valid = gate.validateRequest(
    {
      frame: { top: mockWindow.webContents.mainFrame },
      securityOrigin: 'http://localhost:5173',
      userGesture: true,
      videoRequested: true,
      audioRequested: true,
    },
    mockWindow,
  );
  assert.equal(valid.valid, true);
  assert.equal(gate.isArmed(), false);

  // Subsequent request is denied because gate disarmed
  const replay = gate.validateRequest(
    {
      frame: { top: mockWindow.webContents.mainFrame },
      securityOrigin: 'http://localhost:5173',
      userGesture: true,
      videoRequested: true,
      audioRequested: true,
    },
    mockWindow,
  );
  assert.equal(replay.valid, false);
});

test('SuggestionService question detection accurately identifies interview questions', () => {
  const settingsService = new SettingsService(null, null);
  const service = new SuggestionService({
    settingsService,
    onSuggestion: () => {},
  });

  const questionSegment: TranscriptSegment = {
    id: 's1',
    sessionId: 'test',
    speaker: 'system',
    text: 'How does database sharding differ from replication?',
    isFinal: true,
    startMs: 0,
    endMs: 1000,
  };

  const intent1 = service.detectQuestionAndIntent([questionSegment]);
  assert.equal(intent1.isQuestion, true);
  assert.equal(intent1.speaker, 'system');

  const statementSegment: TranscriptSegment = {
    id: 's2',
    sessionId: 'test',
    speaker: 'user',
    text: 'I worked as a frontend engineer at my previous company.',
    isFinal: true,
    startMs: 0,
    endMs: 1000,
  };

  const intent2 = service.detectQuestionAndIntent([statementSegment]);
  assert.equal(intent2.isQuestion, false);
});

test('SuggestionService testGeminiConnection returns clear error when key is missing', async () => {
  const settingsService = new SettingsService(null, null);
  const service = new SuggestionService({
    settingsService,
    onSuggestion: () => {},
  });

  const result = await service.testGeminiConnection();
  assert.equal(result.ok, false);
  assert.match(result.error.message, /No Gemini API key is configured/i);
});
