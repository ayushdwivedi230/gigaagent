import test from 'node:test';
import assert from 'node:assert/strict';
import { SuggestionService } from '../src/main/services/suggestionService';
import { SettingsService } from '../src/main/services/settingsService';
import type { SuggestionItem, TranscriptSegment } from '@shared/types';

test('SuggestionService produces heuristic suggestions for interview mode', async () => {
  const settingsService = new SettingsService(null, null);
  const suggestions: SuggestionItem[] = [];

  const service = new SuggestionService({
    settingsService,
    onSuggestion: (item) => suggestions.push(item),
    debounceMs: 20, // fast debounce for test
  });

  service.setSession('session_123', 'mock-interview');

  const segment: TranscriptSegment = {
    id: 'seg_1',
    sessionId: 'session_123',
    speaker: 'user',
    startMs: 0,
    endMs: 1000,
    text: 'Could you walk me through your background and project experience?',
    isFinal: true,
  };

  service.handleSegment(segment);

  // Wait for debounce timer to fire
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0]?.sessionId, 'session_123');
  assert.equal(suggestions[0]?.type, 'answer_tip');
  assert.equal(suggestions[0]?.title, 'Use STAR Framework');

  service.destroy();
});

test('SuggestionService ignores interim segments', async () => {
  const settingsService = new SettingsService(null, null);
  const suggestions: SuggestionItem[] = [];

  const service = new SuggestionService({
    settingsService,
    onSuggestion: (item) => suggestions.push(item),
    debounceMs: 20,
  });

  service.setSession('session_456', 'meeting');

  const interimSegment: TranscriptSegment = {
    id: 'seg_2',
    sessionId: 'session_456',
    speaker: 'user',
    startMs: 0,
    endMs: null,
    text: 'We should decide the action item for next week',
    isFinal: false,
  };

  service.handleSegment(interimSegment);

  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(suggestions.length, 0);

  service.destroy();
});

