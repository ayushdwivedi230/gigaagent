import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PREFERENCES, isValidAccelerator, sanitizePreferences } from '@shared/settings';
import { countSpokenWords, estimateSpeakingSeconds, formatSpeakingTime, wordBudgetForSeconds } from '@shared/speaking';
import { inlineText, parseInline, parseMarkdown } from '@shared/markdown';
import { buildSessionExport, exportFileStem } from '@shared/export';
import { LocalEntitlementProvider } from '@shared/entitlements';
import { escapeLike, parseAskOptions, parseExportRequest, parseLibrarySave, parseQuestion, parseRunTool } from '@shared/validation';
import type { SessionDetail, SuggestionItem } from '@shared/types';
import { classifyHttp, describeGeminiError, GeminiClient, GeminiError } from '../src/main/services/geminiClient';
import { parseAnswer, streamingBody } from '../src/main/services/intelligence/answerParser';
import { PromptBuilder } from '../src/main/services/intelligence/promptBuilder';
import { ModeConfigurationService } from '../src/main/services/intelligence/modeConfigurationService';
import { IntentClassifier } from '../src/main/services/intelligence/intentClassifier';
import { ResponseOrchestrator } from '../src/main/services/intelligence/responseOrchestrator';
import { SuggestionService } from '../src/main/services/suggestionService';
import { SettingsService } from '../src/main/services/settingsService';
import { SessionService } from '../src/main/services/sessionService';
import { InMemorySessionRepository } from '../src/main/services/sessionRepository';
import { SqliteSessionRepository } from '../src/main/services/sqliteSessionRepository';
import { MODE_TOOLS, buildToolPrompt, toolsForMode } from '@shared/modeTools';
import { clampToDisplays, defaultBounds, isSafeExternalUrl } from '../src/main/window';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'giga3-'));

// ───────────────────────── Preferences ─────────────────────────

test('preferences: defaults survive garbage input', () => {
  for (const bad of [null, undefined, 42, 'x', [], { appearance: 'nope', ai: { answerFormat: 'huge' } }]) {
    assert.deepEqual(sanitizePreferences(bad), DEFAULT_PREFERENCES);
  }
});

test('preferences: values are clamped and unknown keys dropped', () => {
  const p = sanitizePreferences({
    appearance: { theme: 'light', accent: 'teal', textScale: 9, extra: 1 },
    ai: { answerFormat: 'deep-dive', speakingTargetSec: 45, model: 'DROP TABLE', customInstructions: 'x'.repeat(5000) },
    layout: { leftWidth: 5, rightWidth: 9999, compactBounds: { x: 1.4, y: 2, width: 10, height: 10 } },
    shortcuts: { toggleWindow: 'A', quickAsk: '' },
    __proto__: { polluted: true },
  });
  assert.equal(p.appearance.theme, 'light');
  assert.equal(p.appearance.textScale, 2);
  assert.equal(p.ai.answerFormat, 'deep-dive');
  assert.equal(p.ai.speakingTargetSec, 0); // 45 is not an offered target
  assert.equal(p.ai.model, '');
  assert.equal(p.ai.customInstructions.length, 2000);
  assert.equal(p.layout.leftWidth, 220);
  assert.equal(p.layout.rightWidth, 560);
  assert.deepEqual(p.layout.compactBounds, { x: 1, y: 2, width: 320, height: 400 });
  assert.equal(p.shortcuts.toggleWindow, DEFAULT_PREFERENCES.shortcuts.toggleWindow); // bare key rejected
  assert.equal(p.shortcuts.quickAsk, ''); // empty = disabled
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('accelerators: must include a real modifier', () => {
  for (const ok of ['CommandOrControl+Shift+G', 'Alt+Space', 'Ctrl+F5', '']) assert.equal(isValidAccelerator(ok), true, ok);
  for (const bad of ['G', 'Shift+G', 'Ctrl+Ctrl+G', 'Ctrl+', 'Ctrl+Banana', 7, 'Ctrl+Shift']) assert.equal(isValidAccelerator(bad), false, String(bad));
});

test('settings service: preferences persist, merge partially, and keys never hit disk unencrypted', () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  const noCrypto = new SettingsService(file, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' });
  noCrypto.saveSettings({ geminiApiKey: 'secret-gemini-key-123', preferences: { appearance: { theme: 'high-contrast' } } });
  const disk = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(disk, /secret-gemini-key-123/);
  assert.equal(noCrypto.getClientSettings().credentialStorage, 'memory-only');
  assert.equal(noCrypto.getEffectiveGeminiKey(), 'secret-gemini-key-123'); // still usable this run

  const reloaded = new SettingsService(file, null);
  assert.equal(reloaded.getPreferences().appearance.theme, 'high-contrast');
  assert.equal(reloaded.getPreferences().appearance.accent, 'violet'); // untouched sibling kept
  reloaded.saveSettings({ preferences: { ai: { autoAnswer: false } } });
  assert.equal(reloaded.getPreferences().appearance.theme, 'high-contrast');
  assert.equal(reloaded.getPreferences().ai.autoAnswer, false);
  // Hostile IPC payloads are ignored rather than stored.
  reloaded.saveSettings({ sttProvider: 'evil' as never, geminiApiKey: 5 as never, screenShareInvisibility: 'yes' as never });
  assert.equal(reloaded.getSettings().sttProvider, 'deepgram');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('settings service: corrupted file falls back to defaults and keeps a copy', () => {
  const dir = tmp();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ not json');
  const s = new SettingsService(file, null);
  assert.deepEqual(s.getPreferences(), DEFAULT_PREFERENCES);
  assert.ok(fs.existsSync(`${file}.corrupt`));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ───────────────────────── Speaking time / markdown / export ─────────────────────────

test('speaking time: counts spoken words only and formats as an estimate', () => {
  assert.equal(estimateSpeakingSeconds(''), 0);
  assert.equal(estimateSpeakingSeconds('```js\nconst a = 1;\n```'), 0);
  const words = Array.from({ length: 140 }, () => 'word').join(' ');
  assert.equal(countSpokenWords(`## Heading\n\n- **${words}**`), 141);
  assert.equal(estimateSpeakingSeconds(words), 60);
  assert.equal(wordBudgetForSeconds(30), 70);
  assert.equal(formatSpeakingTime(45), '~45 sec');
  assert.equal(formatSpeakingTime(60), '~1 min');
  assert.equal(formatSpeakingTime(80), '~1 min 20 sec');
});

test('markdown: blocks, inline styles, tables and unterminated code fences', () => {
  const blocks = parseMarkdown('# Title\n\nSome **bold** and `code` and *it*.\n\n- one\n- two\n\n1. a\n2. b\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n```ts\nconst x = 1;');
  assert.deepEqual(blocks.map((b) => b.t), ['heading', 'paragraph', 'list', 'list', 'table', 'quote', 'code']);
  const code = blocks[6]!;
  assert.ok(code.t === 'code' && code.lang === 'ts' && code.closed === false && code.v === 'const x = 1;');
  const para = blocks[1]!;
  assert.ok(para.t === 'paragraph');
  assert.deepEqual(para.c.map((n) => n.t), ['text', 'bold', 'text', 'code', 'text', 'italic', 'text']);
});

test('markdown: model output can never become HTML or an unsafe link', () => {
  const nodes = parseInline('<img src=x onerror=alert(1)> [click](javascript:alert(1)) [ok](https://example.com/a) snake_case_name');
  const links = nodes.filter((n) => n.t === 'link');
  assert.equal(links.length, 1);
  assert.ok(links[0]!.t === 'link' && links[0]!.href === 'https://example.com/a');
  assert.match(inlineText(nodes), /<img src=x onerror=alert\(1\)>/); // kept as literal text
  assert.equal(nodes.some((n) => n.t === 'italic'), false); // snake_case is not emphasis
});

const DETAIL: SessionDetail = {
  summary: { id: 's1', title: 'Design: review / Q3?', mode: 'meeting', source: 'both', startedAt: '2026-11-16T09:00:00.000Z', endedAt: '2026-11-16T09:30:00.000Z', segmentCount: 2 },
  segments: [
    { id: 'a', sessionId: 's1', speaker: 'system', startMs: 1000, endMs: 2000, text: 'Shall we ship Friday?', isFinal: true },
    { id: 'b', sessionId: 's1', speaker: 'user', startMs: 65000, endMs: 66000, text: 'Yes.', isFinal: true },
    { id: 'c', sessionId: 's1', speaker: 'user', startMs: 70000, endMs: null, text: 'interim', isFinal: false },
  ],
  suggestions: [{ id: 'x', sessionId: 's1', createdAt: '2026-11-16T09:01:00.000Z', type: 'answer_tip', title: 'Ship plan', content: 'Ship **Friday**.', question: 'Shall we ship?' }],
};

test('export: markdown, text and json contain the session and only final segments', () => {
  const md = buildSessionExport(DETAIL, [], 'markdown', { exportedAt: '2026-11-16T10:00:00.000Z' });
  assert.match(md, /^# Design: review \/ Q3\?/);
  assert.match(md, /\*\*\[00:01\] Other speaker:\*\* Shall we ship Friday\?/);
  assert.match(md, /\*\*\[01:05\] You:\*\* Yes\./);
  assert.doesNotMatch(md, /interim/);
  assert.match(md, /### Ship plan/);
  assert.match(md, /- \*\*Duration:\*\* 30:00/);
  const txt = buildSessionExport(DETAIL, [], 'text', { includeAnswers: false });
  assert.doesNotMatch(txt, /Ship plan|\*\*/);
  const json = JSON.parse(buildSessionExport(DETAIL, [], 'json')) as { transcript: unknown[]; exportVersion: number };
  assert.equal(json.transcript.length, 2);
  assert.equal(json.exportVersion, 1);
  assert.equal(exportFileStem(DETAIL), 'Design review Q3 2026-11-16'); // Windows-safe
});

// ───────────────────────── Validation ─────────────────────────

test('validation: ask options, questions, tools, library and export requests', () => {
  assert.deepEqual(parseAskOptions({ answerFormat: 'quick', speakingTargetSec: 60, action: 'simplify', mode: 'bogus', requestId: 'bad id!', evil: 1 }), {
    answerFormat: 'quick',
    speakingTargetSec: 60,
    action: 'simplify',
  });
  assert.equal(parseQuestion('   ').ok, false);
  assert.equal(parseQuestion('x'.repeat(4001)).ok, false);
  assert.equal(parseRunTool({ tool: 'rm -rf' }).ok, false);
  assert.equal(parseRunTool({ tool: 'flashcards', input: ' text ' }).ok, true);
  const saved = parseLibrarySave({ kind: 'note', content: 'First line\nmore', tags: ['A', 'a', ' b ', 3] });
  assert.ok(saved.ok && saved.value.title === 'First line' && saved.value.tags?.join() === 'a,b');
  assert.equal(parseLibrarySave({ kind: 'virus', content: 'x' }).ok, false);
  assert.equal(parseLibrarySave({ kind: 'note', content: '  ' }).ok, false);
  assert.equal(parseExportRequest({ sessionId: '../../etc', format: 'markdown' }).ok, false);
  assert.equal(parseExportRequest({ sessionId: 'abc-1', format: 'pdf' }).ok, false);
  assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
});

// ───────────────────────── Gemini client ─────────────────────────

const sse = (chunks: string[]): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    }),
    { status: 200 },
  );
const frame = (text: string): string => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;

test('gemini client: streams deltas, even when an SSE frame is split across network chunks', async () => {
  const deltas: string[] = [];
  const f = frame('world');
  const client = new GeminiClient({
    getApiKey: () => 'k',
    models: ['m1'],
    fetchImpl: async (url, init) => {
      assert.match(url, /m1:streamGenerateContent\?alt=sse$/);
      assert.equal(init.headers['x-goog-api-key'], 'k');
      assert.doesNotMatch(url, /key=/); // the key never travels in the URL
      return sse([frame('Hello '), f.slice(0, 20), f.slice(20)]);
    },
  });
  const res = await client.generate({ prompt: 'hi', onDelta: (t) => deltas.push(t) });
  assert.equal(res.text, 'Hello world');
  assert.deepEqual(deltas, ['Hello ', 'Hello world']);
  assert.equal(client.inFlight, 0);
});

test('gemini client: falls back across models on 429/503/404, but not on auth errors', async () => {
  const seen: string[] = [];
  const client = new GeminiClient({
    getApiKey: () => 'k',
    models: ['a', 'b', 'c'],
    sleep: async () => {},
    fetchImpl: async (url) => {
      const model = /models\/([^:]+):/.exec(url)![1]!;
      seen.push(model);
      if (model === 'a') return new Response('quota', { status: 429 });
      if (model === 'b') return new Response('gone', { status: 404 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 });
    },
  });
  const res = await client.generate({ prompt: 'x', preferredModel: 'a' });
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.equal(res.modelUsed, 'c');

  let calls = 0;
  const auth = new GeminiClient({ getApiKey: () => 'bad', models: ['a', 'b'], fetchImpl: async () => (calls++, new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 })) });
  await assert.rejects(auth.generate({ prompt: 'x' }), (e: unknown) => e instanceof GeminiError && e.kind === 'auth');
  assert.equal(calls, 1);
});

test('gemini client: missing key, empty answers, timeouts and cancellation are distinct errors', async () => {
  await assert.rejects(new GeminiClient({ getApiKey: () => '' }).generate({ prompt: 'x' }), (e: unknown) => e instanceof GeminiError && e.kind === 'not_configured');

  const empty = new GeminiClient({ getApiKey: () => 'k', models: ['a'], fetchImpl: async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }) });
  await assert.rejects(empty.generate({ prompt: 'x' }), (e: unknown) => e instanceof GeminiError && e.kind === 'empty');

  const hang = (_: string, init: { signal: AbortSignal }): Promise<Response> =>
    new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const slow = new GeminiClient({ getApiKey: () => 'k', models: ['a'], timeoutMs: 20, fetchImpl: hang });
  await assert.rejects(slow.generate({ prompt: 'x' }), (e: unknown) => e instanceof GeminiError && e.kind === 'timeout');

  const client = new GeminiClient({ getApiKey: () => 'k', models: ['a'], fetchImpl: hang });
  const controller = new AbortController();
  const pending = client.generate({ prompt: 'x', signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (e: unknown) => e instanceof GeminiError && e.kind === 'cancelled');
  assert.equal(client.inFlight, 0);

  const p2 = client.generate({ prompt: 'x' });
  assert.equal(client.abortAll(), 1);
  await assert.rejects(p2, (e: unknown) => e instanceof GeminiError && e.kind === 'cancelled');
});

test('gemini client: errors shown to users never include response bodies or keys', () => {
  const e = classifyHttp(400, '{"error":{"message":"API key not valid: AIzaSECRETSECRETSECRET"}}');
  assert.equal(e.kind, 'auth');
  assert.doesNotMatch(describeGeminiError(e), /AIza/);
  assert.equal(classifyHttp(500, 'x').kind, 'unavailable');
  assert.match(describeGeminiError(new Error('boom')), /Could not reach Gemini/);
});

// ───────────────────────── Answer parsing / prompts ─────────────────────────

test('answer parser: TITLE contract, legacy JSON, and streaming body', () => {
  assert.deepEqual(parseAnswer('TITLE: Binary search\n\nUse two pointers.'), { title: 'Binary search', content: 'Use two pointers.' });
  assert.deepEqual(parseAnswer('```json\n{"title":"T","content":"C"}\n```'), { title: 'T', content: 'C' });
  assert.deepEqual(parseAnswer('Just prose.'), { content: 'Just prose.' });
  assert.equal(streamingBody(''), '');
  assert.equal(streamingBody('TI'), '');
  assert.equal(streamingBody('TITLE: Binary se'), '');
  assert.equal(streamingBody('TITLE: Binary search\n\nUse two'), 'Use two');
  assert.equal(streamingBody('The answer is'), 'The answer is'); // prose starting with T is shown immediately
  assert.equal(streamingBody('{"title":"T","cont'), ''); // partial JSON envelope is never shown raw
});

test('prompt builder: four formats, speaking target, revisions, profile and honesty rules', () => {
  const builder = new PromptBuilder();
  const profile = new ModeConfigurationService().getProfile('mock-interview');
  const intentMeta = new IntentClassifier().classify('Tell me about a time you handled a conflict');
  const base = { intentMeta, profile, output: 'markdown' as const };
  const quick = builder.buildPrompt({ ...base, answerFormat: 'quick' });
  const natural = builder.buildPrompt({ ...base, answerFormat: 'natural', speakingTargetSec: 60 });
  const structured = builder.buildPrompt({ ...base, answerFormat: 'structured' });
  const deep = builder.buildPrompt({ ...base, answerFormat: 'deep-dive' });
  assert.match(quick, /QUICK: answer in 1-3 sentences/);
  assert.match(natural, /NATURAL/);
  assert.match(natural, /roughly 140 words \(about 60 seconds aloud\)/);
  assert.match(structured, /STRUCTURED/);
  assert.match(deep, /DEEP DIVE/);
  assert.equal(new Set([quick, natural, structured, deep]).size, 4);
  for (const p of [quick, natural, structured, deep]) {
    assert.match(p, /do not invent facts, figures, names, quotes, references or confidence scores/i);
    assert.match(p, /TITLE: <concise title/);
    assert.doesNotMatch(p, /valid JSON object/);
  }
  const revised = builder.buildPrompt({ ...base, action: 'simplify', previousAnswer: 'PREVIOUS-ANSWER-TEXT', preparationProfile: 'QA engineer, 2 yrs', customInstructions: 'British spelling' });
  assert.match(revised, /simpler language/);
  assert.match(revised, /PREVIOUS-ANSWER-TEXT/);
  assert.match(revised, /QA engineer, 2 yrs/);
  assert.match(revised, /British spelling/);
  // Legacy JSON contract is still the default for non-streaming callers.
  assert.match(builder.buildPrompt({ intentMeta, profile }), /Return ONLY a valid JSON object/);
});

test('orchestrator: streams, tags the answer with format/requestId, and can be cancelled', async () => {
  const deltas: string[] = [];
  const o = new ResponseOrchestrator({
    onEmitSuggestion: () => {},
    geminiRequester: async (prompt, _img, opts) => {
      assert.equal(opts?.json, false);
      assert.match(prompt, /QUICK/);
      opts?.onDelta?.('TITLE: CAP theorem\n\nPick two');
      opts?.onDelta?.('TITLE: CAP theorem\n\nPick two of three.');
      return { text: 'TITLE: CAP theorem\n\nPick two of three guarantees under partition.', modelUsed: 'm' };
    },
  });
  const res = await o.processUtterance({ text: 'Explain the CAP theorem', isManual: true, answerFormat: 'quick', requestId: 'r1', onDelta: (t) => deltas.push(t) });
  assert.ok(res.ok && res.value);
  assert.equal(res.value.title, 'CAP theorem');
  assert.equal(res.value.answerFormat, 'quick');
  assert.equal(res.value.requestId, 'r1');
  assert.deepEqual(deltas, ['Pick two', 'Pick two of three.']);
  assert.equal(o.inFlightCount, 0);

  const slow = new ResponseOrchestrator({
    onEmitSuggestion: () => assert.fail('a cancelled answer must not be emitted'),
    geminiRequester: (_p, _i, opts) => new Promise((_res, rej) => opts!.signal!.addEventListener('abort', () => rej(new Error('aborted')))),
  });
  const pending = slow.processUtterance({ text: 'Explain Raft consensus', isManual: true, requestId: 'r2' });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(slow.cancel('r2'), 1);
  const cancelled = await pending;
  assert.ok(!cancelled.ok && cancelled.error.code === 'CANCELLED');
  assert.equal(slow.cancel('nope'), 0);
});

// ───────────────────────── Suggestion service ─────────────────────────

function serviceWith(fetchImpl: (url: string) => Promise<Response>, extra: Partial<ConstructorParameters<typeof SuggestionService>[0]> = {}) {
  const settings = new SettingsService(null, null);
  settings.saveSettings({ geminiApiKey: 'test-key' });
  const emitted: SuggestionItem[] = [];
  const deltas: Array<[string, string]> = [];
  const service = new SuggestionService({
    settingsService: settings,
    onSuggestion: (s) => emitted.push(s),
    onDelta: (id, text) => deltas.push([id, text]),
    gemini: { fetchImpl: (url) => fetchImpl(url), models: ['m'], sleep: async () => {} },
    ...extra,
  });
  return { settings, service, emitted, deltas };
}

test('ask: a failed request is reported as an error — no fabricated answer', async () => {
  const { service, emitted } = serviceWith(async () => new Response('down', { status: 503 }));
  const res = await service.askQuestion('What is a mutex?');
  assert.ok(!res.ok);
  assert.equal(res.error.code, 'SOURCE_FAILED');
  assert.match(res.error.message, /temporarily unavailable/i);
  assert.equal(emitted.length, 0);
  assert.equal(service.getUsage().failures, 1);
  service.destroy();
});

test('ask: streams with a requestId and honours the preferred format', async () => {
  let body = '';
  const { service, settings, emitted, deltas } = serviceWith(async () => sse([frame('TITLE: Mutex\n\nA mutex '), frame('guards a critical section.')]));
  settings.saveSettings({ preferences: { ai: { answerFormat: 'deep-dive' } } });
  const res = await service.askQuestion('What is a mutex?', { requestId: 'req-1' });
  assert.ok(res.ok);
  assert.equal(res.value.title, 'Mutex');
  assert.equal(res.value.content, 'A mutex guards a critical section.');
  assert.equal(res.value.answerFormat, 'deep-dive');
  await new Promise((r) => setTimeout(r, 90)); // throttled trailing delta
  assert.ok(deltas.length >= 1 && deltas.every(([id]) => id === 'req-1'));
  body = deltas[deltas.length - 1]![1];
  assert.match(body, /^A mutex/);
  assert.equal(emitted.length, 1);
  service.destroy();
});

test('privacy: cloud AI and cloud screenshot switches are enforced in the main process', async () => {
  let calls = 0;
  const { service, settings } = serviceWith(async () => (calls++, sse([frame('TITLE: T\n\nBody text long enough to pass.')])));
  settings.saveSettings({ preferences: { privacy: { allowCloudAi: false } } });
  const off = await service.askQuestion('What is a mutex?');
  assert.ok(!off.ok && off.error.code === 'CONSENT_REQUIRED');
  const tool = await service.runTool({ tool: 'summarise', input: 'Some long enough material to summarise here.' });
  assert.ok(!tool.ok && tool.error.code === 'CONSENT_REQUIRED');
  settings.saveSettings({ preferences: { privacy: { allowCloudAi: true, allowCloudScreenshots: false } } });
  const shot = await service.analyzeScreenshot({ question: 'What is on screen?' });
  assert.ok(!shot.ok && shot.error.code === 'CONSENT_REQUIRED');
  assert.equal(calls, 0);
  service.destroy();
});

test('auto-answer: switch and pause both stop automatic generation', async () => {
  let calls = 0;
  const { service, settings } = serviceWith(async () => (calls++, new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"title":"T","content":"A sufficiently long answer body."}' }] } }] }), { status: 200 })), { debounceMs: 10, minIntervalMs: 0 });
  const seg = (id: string) => ({ id, sessionId: 's', speaker: 'system' as const, startMs: 0, endMs: 1, text: 'Can you explain what a database index is and why it helps?', isFinal: true });
  service.setSession('s', 'general');
  settings.saveSettings({ preferences: { ai: { autoAnswer: false } } });
  service.handleSegment(seg('1'));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls, 0);
  settings.saveSettings({ preferences: { ai: { autoAnswer: true } } });
  service.setPaused(true);
  service.handleSegment(seg('2'));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls, 0);
  service.setPaused(false);
  service.handleSegment(seg('3'));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls, 1);
  service.destroy();
});

test('mode tools: every mode has real tools; prompts are grounded; transcript is required', async () => {
  for (const mode of ['mock-interview', 'meeting', 'study', 'general'] as const) assert.ok(toolsForMode(mode).length >= 2, mode);
  assert.equal(new Set(MODE_TOOLS.map((t) => t.id)).size, MODE_TOOLS.length);
  const prompt = buildToolPrompt({ tool: MODE_TOOLS.find((t) => t.id === 'action-items')!, material: 'Priya will send the report by Friday.' });
  assert.match(prompt, /Never invent names, owners, dates/);
  assert.match(prompt, /Priya will send the report by Friday\./);

  let seenBody = '';
  const { service, emitted } = serviceWith(async () => sse([frame('TITLE: Actions\n\n| Task | Owner | Due |\n|---|---|---|\n| Send report | Priya | Friday |')]), {
    getTranscriptText: () => 'Other speaker: Priya will send the report by Friday.\nYou: Great, thanks.',
  });
  const none = await new SuggestionService({ settingsService: (() => { const s = new SettingsService(null, null); s.saveSettings({ geminiApiKey: 'k' }); return s; })(), onSuggestion: () => {} }).runTool({ tool: 'meeting-summary' });
  assert.ok(!none.ok && /not enough transcript/i.test(none.error.message));
  const res = await service.runTool({ tool: 'action-items', requestId: 'tool-1' });
  assert.ok(res.ok);
  seenBody = res.value.content;
  assert.match(seenBody, /\| Send report \| Priya \| Friday \|/);
  assert.equal(res.value.tool, 'action-items');
  assert.equal(res.value.type, 'action_item');
  assert.equal(emitted.length, 1);
  service.destroy();
});

// ───────────────────────── Sessions, storage, library ─────────────────────────

test('session pause: transcript arriving while paused is discarded; state is reported', async () => {
  let push: ((s: { id: string; startMs: number; endMs: number | null; text: string; isFinal: boolean }) => void) | null = null;
  const repo = new InMemorySessionRepository();
  const svc = new SessionService({
    repository: repo,
    createSource: () => ({ kind: 'demo', start: async (onSegment) => { push = onSegment; }, stop: async () => {} }),
  });
  assert.equal(svc.setPaused(true).ok, false); // nothing running
  await svc.start({ mode: 'meeting' });
  push!({ id: '1', startMs: 0, endMs: 1, text: 'kept one', isFinal: true });
  assert.deepEqual(svc.setPaused(true), { ok: true, value: { paused: true } });
  assert.equal(svc.getSnapshot().paused, true);
  push!({ id: '2', startMs: 2, endMs: 3, text: 'dropped', isFinal: true });
  svc.setPaused(false);
  push!({ id: '3', startMs: 4, endMs: 5, text: 'kept two', isFinal: true });
  assert.equal(svc.getTranscriptText(), 'You: kept one\nYou: kept two');
  const stopped = await svc.stop();
  assert.ok(stopped.ok && stopped.value.segmentCount === 2);
  assert.equal(svc.getSnapshot().paused, undefined);
});

for (const [name, make] of [
  ['in-memory', async () => new InMemorySessionRepository()],
  ['sqlite', async () => SqliteSessionRepository.create({ filePath: null })],
] as const) {
  test(`library (${name}): save, update, search, filter, delete`, async () => {
    const repo = await make();
    const a = repo.saveLibraryItem({ kind: 'answer', title: 'CAP theorem', content: 'Pick two of three.', tags: ['distributed'], question: 'Explain CAP' }, '2026-01-01T00:00:00.000Z');
    const n = repo.saveLibraryItem({ kind: 'note', title: 'Follow up', content: '100% of users_like it' }, '2026-01-02T00:00:00.000Z');
    repo.saveLibraryItem({ kind: 'prompt', title: 'Concise', content: 'Answer in two lines.' }, '2026-01-03T00:00:00.000Z');
    assert.deepEqual(repo.listLibrary().map((i) => i.title), ['Concise', 'Follow up', 'CAP theorem']);
    assert.deepEqual(repo.listLibrary({ kind: 'answer' }).map((i) => i.id), [a.id]);
    assert.deepEqual(repo.listLibrary({ search: 'distributed' }).map((i) => i.id), [a.id]);
    assert.deepEqual(repo.listLibrary({ search: '100%' }).map((i) => i.id), [n.id]); // % is literal, not a wildcard
    assert.equal(repo.listLibrary({ search: '%' }).length, 1);
    const updated = repo.saveLibraryItem({ id: a.id, kind: 'answer', title: 'CAP', content: 'Updated.' }, '2026-02-01T00:00:00.000Z');
    assert.equal(updated.createdAt, '2026-01-01T00:00:00.000Z');
    assert.deepEqual(updated.tags, ['distributed']); // omitted fields are preserved
    assert.equal(repo.listLibrary()[0]!.id, a.id);
    assert.equal(repo.deleteLibraryItem(n.id), true);
    assert.equal(repo.deleteLibraryItem(n.id), false);
    assert.equal(repo.clearLibrary(), 2);
  });

  test(`transcript search (${name}): literal, case-insensitive, final segments only`, async () => {
    const repo = await make();
    repo.create({ id: 's1', title: 'Standup', mode: 'meeting', source: 'both', startedAt: '2026-01-01T00:00:00.000Z', endedAt: null, segmentCount: 0 });
    repo.upsertSegment({ id: 'a', sessionId: 's1', speaker: 'system', startMs: 5, endMs: 6, text: 'The Kafka consumer lag is growing', isFinal: true });
    repo.upsertSegment({ id: 'b', sessionId: 's1', speaker: 'user', startMs: 9, endMs: null, text: 'kafka interim', isFinal: false });
    const hits = repo.searchTranscripts('kafka');
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.sessionTitle, 'Standup');
    assert.equal(hits[0]!.speaker, 'system');
    assert.equal(repo.searchTranscripts('_').length, 0);
  });
}

test('sqlite: deleting a session removes its transcript and answers even after a save (sql.js export resets PRAGMAs)', async () => {
  const dir = tmp();
  const file = path.join(dir, 'sessions.db');
  const repo = await SqliteSessionRepository.create({ filePath: file });
  const summary = { id: 's1', title: 'T', mode: 'general' as const, source: 'demo' as const, startedAt: '2026-01-01T00:00:00.000Z', endedAt: null, segmentCount: 0 };
  repo.create(summary); // persists => export() => PRAGMA foreign_keys reset inside sql.js
  repo.upsertSegment({ id: 'a', sessionId: 's1', speaker: 'user', startMs: 0, endMs: 1, text: 'confidential words', isFinal: true });
  repo.upsertSuggestion({ id: 'x', sessionId: 's1', createdAt: '2026-01-01T00:00:01.000Z', type: 'answer_tip', title: 'A', content: 'secret answer', question: 'Q?', answerFormat: 'quick', modelUsed: 'm' });
  repo.flush();
  // Answer metadata now round-trips (previously only type/title/content were stored).
  const stored = repo.get('s1')!.suggestions![0]!;
  assert.equal(stored.question, 'Q?');
  assert.equal(stored.answerFormat, 'quick');
  assert.equal(stored.modelUsed, 'm');
  const linked = repo.saveLibraryItem({ kind: 'answer', title: 'kept', content: 'kept', sessionId: 's1' });
  assert.equal(repo.delete('s1'), true);
  repo.flush();
  assert.equal(repo.searchTranscripts('confidential').length, 0);
  repo.close();
  const bytes = fs.readFileSync(file);
  const reopened = await SqliteSessionRepository.create({ filePath: file });
  assert.equal(reopened.list().length, 0);
  assert.equal(reopened.getLibraryItem(linked.id)?.sessionId, null); // saved item survives, unlinked
  // Re-creating the same id must not resurrect old rows.
  reopened.create(summary);
  assert.equal(reopened.get('s1')!.segments.length, 0);
  assert.equal(reopened.get('s1')!.suggestions!.length, 0);
  reopened.close();
  assert.ok(bytes.length > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sqlite: an answer for a session that does not exist is ignored instead of throwing', async () => {
  const repo = await SqliteSessionRepository.create({ filePath: null });
  assert.doesNotThrow(() => repo.upsertSuggestion({ id: 'x', sessionId: 'manual_query', createdAt: 'now', type: 'answer_tip', title: 'A', content: 'B' }));
  repo.close();
});

test('sqlite: large transcript stays fast and bounded (5,000 segments)', async () => {
  const repo = await SqliteSessionRepository.create({ filePath: null });
  repo.create({ id: 'big', title: 'Big', mode: 'meeting', source: 'both', startedAt: '2026-01-01T00:00:00.000Z', endedAt: null, segmentCount: 0 });
  const t0 = performance.now();
  for (let i = 0; i < 5000; i++) repo.upsertSegment({ id: `seg${i}`, sessionId: 'big', speaker: i % 2 ? 'user' : 'system', startMs: i * 1000, endMs: i * 1000 + 900, text: `utterance number ${i} about topic ${i % 50}`, isFinal: true });
  const insertMs = performance.now() - t0;
  const t1 = performance.now();
  const detail = repo.get('big')!;
  const hits = repo.searchTranscripts('topic 7', 500);
  const readMs = performance.now() - t1;
  assert.equal(detail.segments.length, 5000);
  assert.equal(hits.length, 100);
  console.log(`# perf: 5000 inserts ${insertMs.toFixed(0)}ms, load+search ${readMs.toFixed(0)}ms (node:sqlite test shim, not sql.js)`);
  assert.ok(insertMs < 15000 && readMs < 3000);
  repo.close();
});

// ───────────────────────── Window / misc ─────────────────────────

test('window: remembered bounds are dropped when their monitor is gone', () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
  const min = { minWidth: 340, minHeight: 480 };
  assert.deepEqual(clampToDisplays({ x: 1500, y: 40, width: 400, height: 660 }, displays, min), { x: 1500, y: 40, width: 400, height: 660 });
  assert.equal(clampToDisplays({ x: 2600, y: 40, width: 400, height: 660 }, displays, min), null);
  assert.equal(clampToDisplays({ x: 100, y: 100, width: 200, height: 200 }, displays, min)!.width, 340);
  const compact = defaultBounds('compact', displays[0]!.workArea);
  assert.equal(compact.x + compact.width, 1900);
  const expanded = defaultBounds('expanded', { x: 0, y: 0, width: 1000, height: 700 });
  assert.ok(expanded.width <= 960 && expanded.height <= 660);
});

test('window: only plain https links may open externally', () => {
  assert.equal(isSafeExternalUrl('https://ai.google.dev/'), true);
  for (const bad of ['http://example.com', 'file:///C:/Windows', 'javascript:alert(1)', 'https://user:pw@example.com', 'ms-settings:privacy', 'nope']) {
    assert.equal(isSafeExternalUrl(bad), false, bad);
  }
});

test('entitlements: local provider grants local features and claims nothing about licensing', () => {
  const e = new LocalEntitlementProvider();
  assert.equal(e.get().source, 'local');
  assert.equal(e.has('ai-answers'), true);
  assert.equal(e.has('cloud-sync'), false);
  assert.equal(e.get().limits.aiRequestsPerDay, null);
});
