import test from 'node:test';
import assert from 'node:assert/strict';
import { ScreenContextManager } from '../src/main/services/screenContextManager';
import { ScreenCaptureService } from '../src/main/services/screenCaptureService';
import { SuggestionService } from '../src/main/services/suggestionService';
import { SettingsService } from '../src/main/services/settingsService';
import type { DesktopCapturerSource } from 'electron';
import type { ScreenshotData, SuggestionItem } from '@shared/types';

test('ScreenContextManager enforces explicit user confirmation lifecycle', () => {
  const manager = new ScreenContextManager();
  assert.equal(manager.hasContext(), false);
  assert.equal(manager.getPending(), null);
  assert.equal(manager.getConfirmed(), null);

  const mockScreenshot: ScreenshotData = {
    id: 'scr_100',
    sourceId: 'screen:0:0',
    sourceName: 'Primary Screen',
    dataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
    base64: 'ZmFrZQ==',
    width: 1920,
    height: 1080,
    capturedAt: new Date().toISOString(),
  };

  // 1. Stage pending screenshot
  manager.setPending(mockScreenshot);
  assert.equal(manager.hasContext(), false);
  assert.equal(manager.getPending()?.id, 'scr_100');
  assert.equal(manager.getConfirmed(), null);

  // 2. Reject confirmation with wrong ID
  const wrongConfirm = manager.confirm('scr_wrong');
  assert.equal(wrongConfirm, false);
  assert.equal(manager.hasContext(), false);

  // 3. Confirm with valid ID
  const confirmed = manager.confirm('scr_100');
  assert.equal(confirmed, true);
  assert.equal(manager.hasContext(), true);
  assert.equal(manager.getConfirmed()?.id, 'scr_100');
  assert.equal(manager.getPending(), null);

  // 4. Add multi-turn conversations
  manager.addTurn('What does this function do?', 'It calculates binary search in O(log n).');
  manager.addTurn('What are the edge cases?', 'Empty arrays and single element arrays.');
  const turns = manager.getTurns();
  assert.equal(turns.length, 2);
  assert.equal(turns[0]?.question, 'What does this function do?');

  // 5. Clear context
  manager.clear();
  assert.equal(manager.hasContext(), false);
  assert.equal(manager.getConfirmed(), null);
  assert.equal(manager.getTurns().length, 0);
});

test('ScreenContextManager discard removes pending screenshot without altering confirmed', () => {
  const manager = new ScreenContextManager();
  const mockScreenshot: ScreenshotData = {
    id: 'scr_200',
    sourceId: 'window:123',
    sourceName: 'VS Code',
    dataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
    base64: 'ZmFrZQ==',
    width: 1280,
    height: 720,
    capturedAt: new Date().toISOString(),
  };

  manager.setPending(mockScreenshot);
  assert.equal(manager.getPending()?.id, 'scr_200');

  const discarded = manager.discard('scr_200');
  assert.equal(discarded, true);
  assert.equal(manager.getPending(), null);
  assert.equal(manager.hasContext(), false);
});

test('ScreenCaptureService enumerates sources and captures single high-res screenshot', async () => {
  const mockThumbnail = {
    toJPEG: (_q: number) => Buffer.from('mock-jpeg-bytes'),
    toDataURL: () => 'data:image/png;base64,mockpreview',
    getSize: () => ({ width: 1920, height: 1080 }),
  };

  const mockSources: DesktopCapturerSource[] = [
    {
      id: 'screen:0:0',
      name: 'Entire Screen 1',
      thumbnail: mockThumbnail as any,
      display_id: 'display_1',
      appIcon: null as any,
    },
    {
      id: 'window:999:0',
      name: 'Terminal',
      thumbnail: mockThumbnail as any,
      display_id: '',
      appIcon: null as any,
    },
  ];

  const mockCapturer = {
    getSources: async (_options: any) => mockSources,
  };

  const service = new ScreenCaptureService({ capturer: mockCapturer });

  // 1. Enumerate available sources
  const sourcesRes = await service.getAvailableSources();
  assert.equal(sourcesRes.ok, true);
  if (sourcesRes.ok) {
    assert.equal(sourcesRes.value.length, 2);
    assert.equal(sourcesRes.value[0]?.id, 'screen:0:0');
    assert.equal(sourcesRes.value[0]?.isScreen, true);
    assert.equal(sourcesRes.value[1]?.id, 'window:999:0');
    assert.equal(sourcesRes.value[1]?.isScreen, false);
  }

  // 2. Explicit screenshot capture
  const captureRes = await service.capture('window:999:0');
  assert.equal(captureRes.ok, true);
  if (captureRes.ok) {
    assert.equal(captureRes.value.sourceId, 'window:999:0');
    assert.equal(captureRes.value.sourceName, 'Terminal');
    assert.equal(captureRes.value.width, 1920);
    assert.equal(captureRes.value.height, 1080);
    assert.equal(typeof captureRes.value.base64, 'string');
    assert.match(captureRes.value.dataUrl, /^data:image\/jpeg;base64,/);
  }
});

test('ScreenCaptureService handles empty capture sources gracefully', async () => {
  const emptyCapturer = {
    getSources: async (_options: any) => [],
  };

  const service = new ScreenCaptureService({ capturer: emptyCapturer });
  const captureRes = await service.capture();
  assert.equal(captureRes.ok, false);
  if (!captureRes.ok) {
    assert.equal(captureRes.error.code, 'SOURCE_FAILED');
    assert.match(captureRes.error.message, /no screen or window sources found/i);
  }
});

test('SuggestionService analyzeScreenshot validates authentication and active screenshot', async () => {
  const settingsService = new SettingsService(null, null);
  const manager = new ScreenContextManager();
  const suggestions: SuggestionItem[] = [];

  const service = new SuggestionService({
    settingsService,
    screenContextManager: manager,
    onSuggestion: (item) => suggestions.push(item),
  });

  // 1. Fails when no Gemini API key is configured
  const resNoKey = await service.analyzeScreenshot({ question: 'Explain this error' });
  assert.equal(resNoKey.ok, false);
  if (!resNoKey.ok) {
    assert.equal(resNoKey.error.code, 'INVALID_REQUEST');
    assert.match(resNoKey.error.message, /No Gemini API key is configured/i);
  }

  service.destroy();
});
