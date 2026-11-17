import { parseAskOptions } from '@shared/validation';
import type {
  AskOptions,
  Result,
  RunToolRequest,
  ScreenAnalysisRequest,
  ScreenshotData,
  SessionMode,
  SuggestionItem,
  TranscriptSegment,
} from '@shared/types';
import type { SettingsService } from './settingsService';
import type { ScreenContextManager } from './screenContextManager';
import { ResponseOrchestrator } from './intelligence/responseOrchestrator';
import { parseAnswer, streamingBody } from './intelligence/answerParser';
import { describeGeminiError, GeminiClient, GeminiError } from './geminiClient';
import type { GeminiClientOptions } from './geminiClient';
import { buildToolPrompt, getModeTool } from '@shared/modeTools';
import { logDiag } from './diagnosticsLogger';

export interface AiUsageSnapshot {
  requests: number;
  failures: number;
  cancelled: number;
  lastLatencyMs: number | null;
  lastModel: string | null;
  promptTokens: number;
  outputTokens: number;
}

export interface SuggestionServiceOptions {
  settingsService: SettingsService;
  onSuggestion: (suggestion: SuggestionItem) => void;
  screenContextManager?: ScreenContextManager;
  debounceMs?: number;
  minIntervalMs?: number;
  /** Streaming progress for manual questions and tools. `text` is the answer body so far. */
  onDelta?: (requestId: string, text: string, question?: string) => void;
  /** Resolves the active preparation profile text (library item) for prompt context. */
  getProfileText?: (id: string) => string | undefined;
  /** Supplies recent transcript text for mode tools when no input is passed. */
  getTranscriptText?: (sessionId?: string) => string;
  /** Test seam / future provider switch. */
  gemini?: Partial<GeminiClientOptions>;
  onUsage?: (usage: AiUsageSnapshot) => void;
}

export interface DetectedIntent {
  isQuestion: boolean;
  questionText: string;
  speaker: 'user' | 'system';
  topic: string;
}

const NO_KEY = 'No Gemini API key is configured. Please enter your Gemini API Key in Settings.';
const CLOUD_AI_OFF = 'Cloud AI is turned off in Settings → Privacy. Turn it on to generate answers.';
const DELTA_INTERVAL_MS = 60;

export class SuggestionService {
  private readonly settingsService: SettingsService;
  private readonly onSuggestion: (suggestion: SuggestionItem) => void;
  private readonly screenContextManager: ScreenContextManager | undefined;
  private readonly orchestrator: ResponseOrchestrator;
  private readonly client: GeminiClient;
  private readonly debounceMs: number;
  private readonly minIntervalMs: number;
  private readonly onDelta: ((requestId: string, text: string, question?: string) => void) | undefined;
  private readonly getProfileText: ((id: string) => string | undefined) | undefined;
  private readonly getTranscriptText: ((sessionId?: string) => string) | undefined;
  private readonly onUsage: ((usage: AiUsageSnapshot) => void) | undefined;
  private readonly toolControllers = new Map<string, AbortController>();
  private readonly usage: AiUsageSnapshot = {
    requests: 0,
    failures: 0,
    cancelled: 0,
    lastLatencyMs: null,
    lastModel: null,
    promptTokens: 0,
    outputTokens: 0,
  };

  private activeSessionId: string | null = null;
  private currentMode: SessionMode = 'mock-interview';
  private accumulatedSegments: TranscriptSegment[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private suggestionCounter = 0;
  private isProcessing = false;
  private lastQueryTimestamp = 0;
  private lastQueriedText = '';
  private paused = false;

  constructor(options: SuggestionServiceOptions) {
    this.settingsService = options.settingsService;
    this.onSuggestion = options.onSuggestion;
    this.screenContextManager = options.screenContextManager;
    this.debounceMs = options.debounceMs ?? 2000;
    this.minIntervalMs = options.minIntervalMs ?? 2500; // 2.5s cooldown for snappier follow-up responses
    this.onDelta = options.onDelta;
    this.getProfileText = options.getProfileText;
    this.getTranscriptText = options.getTranscriptText;
    this.onUsage = options.onUsage;

    this.client = new GeminiClient({
      getApiKey: () => this.settingsService.getEffectiveGeminiKey(),
      ...options.gemini,
    });

    this.orchestrator = new ResponseOrchestrator({
      onEmitSuggestion: (item) => this.emit(item),
      describeError: (error) => ({
        message: describeGeminiError(error),
        cancelled: error instanceof GeminiError && error.kind === 'cancelled',
      }),
      geminiRequester: (prompt, screenBase64, opts) =>
        this.track(() =>
          this.client.generate({
            prompt,
            imageBase64: screenBase64,
            signal: opts?.signal,
            onDelta: opts?.onDelta,
            json: opts?.json ?? true,
            maxOutputTokens: opts?.maxOutputTokens ?? (screenBase64 ? 2048 : 1024),
            temperature: screenBase64 ? 0.2 : 0.3,
            preferredModel: opts?.preferredModel || this.prefs().ai.model || undefined,
          }),
        ),
    });
  }

  getOrchestrator(): ResponseOrchestrator {
    return this.orchestrator;
  }

  getUsage(): AiUsageSnapshot {
    return { ...this.usage };
  }

  /** While paused, transcript segments are ignored and no automatic answers are generated. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused && this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /** Cancels in-flight answers (one id, or all). Returns the number cancelled. */
  cancel(requestId?: string): number {
    let count = this.orchestrator.cancel(requestId);
    const tools = requestId ? [requestId].filter((id) => this.toolControllers.has(id)) : [...this.toolControllers.keys()];
    for (const id of tools) {
      this.toolControllers.get(id)?.abort();
      this.toolControllers.delete(id);
      count++;
    }
    if (!requestId) count = Math.max(count, this.client.abortAll());
    return count;
  }

  setSession(sessionId: string | null, mode: SessionMode = 'mock-interview'): void {
    if (this.activeSessionId !== sessionId || this.currentMode !== mode) {
      this.activeSessionId = sessionId;
      this.currentMode = mode;
      this.accumulatedSegments = [];
      this.suggestionCounter = 0;
      this.lastQueryTimestamp = 0;
      this.lastQueriedText = '';
      this.paused = false;
      this.orchestrator.setSession(sessionId, mode);
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      logDiag('AIDiag:01-Session', 'Active session updated in SuggestionService', { sessionId, mode });
    }
  }

  handleSegment(segment: TranscriptSegment): void {
    if (!this.activeSessionId || segment.sessionId !== this.activeSessionId) return;
    if (!segment.isFinal || this.paused) return;

    this.accumulatedSegments.push(segment);
    // Bounded memory: only the recent window is ever used for prompts.
    if (this.accumulatedSegments.length > 200) this.accumulatedSegments = this.accumulatedSegments.slice(-100);

    if (!this.prefs().ai.autoAnswer) return;

    const intent = this.detectQuestionAndIntent([segment]);
    // Transcript text is user content: log shape only, never the words.
    logDiag('AIDiag:01-Segment', 'Final segment received', {
      segmentId: segment.id,
      speaker: segment.speaker,
      chars: segment.text.length,
      isQuestion: intent.isQuestion,
    });

    // If any participant asks a question, immediately shorten debounce (300ms) for low-latency assistance
    const delay = intent.isQuestion ? Math.min(300, this.debounceMs) : Math.min(1000, this.debounceMs);

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.generateSuggestion();
    }, delay);
  }

  /**
   * Identifies questions, technical interview inquiries, and key intents from recent utterances.
   */
  detectQuestionAndIntent(segments: TranscriptSegment[]): DetectedIntent {
    if (segments.length === 0) {
      return { isQuestion: false, questionText: '', speaker: 'user', topic: 'general' };
    }

    const last = segments[segments.length - 1]!;
    const combined = segments
      .slice(-3)
      .map((s) => s.text)
      .join(' ')
      .trim();

    const detection = this.orchestrator.detector.detect(combined);
    const intentMeta = this.orchestrator.classifier.classify(combined);
    const isQuestion =
      (detection.isQuestionOrInstruction || last.speaker === 'system') && intentMeta.intent !== 'ACKNOWLEDGEMENT';

    return {
      isQuestion,
      questionText: isQuestion ? combined : '',
      speaker: last.speaker,
      topic: this.currentMode,
    };
  }

  private prefs() {
    return this.settingsService.getPreferences();
  }

  private profileText(): string | undefined {
    const id = this.prefs().ai.activeProfileId;
    return id ? this.getProfileText?.(id)?.slice(0, 6000) : undefined;
  }

  private async track<T extends { modelUsed: string; latencyMs?: number; usage?: { promptTokens: number; outputTokens: number } | undefined }>(
    run: () => Promise<T>,
  ): Promise<T> {
    this.usage.requests++;
    try {
      const result = await run();
      this.usage.lastLatencyMs = result.latencyMs ?? null;
      this.usage.lastModel = result.modelUsed;
      this.usage.promptTokens += result.usage?.promptTokens ?? 0;
      this.usage.outputTokens += result.usage?.outputTokens ?? 0;
      return result;
    } catch (error) {
      if (error instanceof GeminiError && error.kind === 'cancelled') this.usage.cancelled++;
      else this.usage.failures++;
      throw error;
    } finally {
      this.onUsage?.(this.getUsage());
    }
  }

  private throttledDelta(requestId: string | undefined, question?: string): ((text: string) => void) | undefined {
    if (!requestId || !this.onDelta) return undefined;
    let last = 0;
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const send = (): void => {
      timer = null;
      if (pending === null) return;
      last = Date.now();
      this.onDelta?.(requestId, pending, question);
      pending = null;
    };
    return (text) => {
      if (!text) return;
      pending = text;
      const wait = DELTA_INTERVAL_MS - (Date.now() - last);
      if (wait <= 0) send();
      else if (!timer) timer = setTimeout(send, wait);
    };
  }

  private async generateSuggestion(): Promise<void> {
    if (this.isProcessing || this.paused || !this.activeSessionId || this.accumulatedSegments.length === 0) return;

    const now = Date.now();
    if (now - this.lastQueryTimestamp < this.minIntervalMs) {
      const waitMs = this.minIntervalMs - (now - this.lastQueryTimestamp) + 200;
      if (!this.debounceTimer) {
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          void this.generateSuggestion();
        }, waitMs);
      }
      return;
    }

    const recentSegments = this.accumulatedSegments.slice(-6);
    const lastSeg = recentSegments[recentSegments.length - 1]!;
    const recentText = recentSegments
      .map((s) => `${s.speaker === 'system' ? '[Other speaker]' : '[You]'}: ${s.text}`)
      .join('\n')
      .trim();

    if (recentText.length < 15 || recentText === this.lastQueriedText) return;

    this.isProcessing = true;
    this.lastQueryTimestamp = now;
    this.lastQueriedText = recentText;

    const intent = this.detectQuestionAndIntent(recentSegments);
    const prefs = this.prefs();
    const hasKey = Boolean(this.settingsService.getEffectiveGeminiKey());

    try {
      if (hasKey && prefs.privacy.allowCloudAi) {
        // Screenshots ride along with automatic answers only when the user opted in.
        const activeScreen =
          prefs.ai.attachScreenToAuto && prefs.privacy.allowCloudScreenshots ? this.screenContextManager?.getConfirmed() : null;
        const res = await this.orchestrator.processUtterance({
          text: lastSeg.text,
          speaker: lastSeg.speaker,
          mode: this.currentMode,
          context: recentText,
          sessionId: this.activeSessionId ?? undefined,
          screenshotBase64: activeScreen?.base64,
          answerFormat: prefs.ai.answerFormat,
          speakingTargetSec: prefs.ai.speakingTargetSec || undefined,
          customInstructions: prefs.ai.customInstructions || undefined,
          preparationProfile: this.profileText(),
        });
        if (!res.ok && res.error.code !== 'CANCELLED') {
          this.generateHeuristicSuggestion(recentText, intent, res.error.message);
        }
      } else {
        logDiag('AIDiag:Fallback', 'Cloud AI unavailable (no key or disabled), generating local heuristic tip');
        this.generateHeuristicSuggestion(recentText, intent);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDiag('AIDiag:Fallback', 'Gemini query failed, falling back to heuristic', { error: errMsg });
      this.generateHeuristicSuggestion(recentText, intent, errMsg);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Manual Ask AI. Streams when a requestId is supplied. Failures are returned as errors —
   * the app never substitutes a canned "answer" for a failed request.
   */
  async askQuestion(question: string, rawOptions?: AskOptions & { ignoreScreenContext?: boolean }): Promise<Result<SuggestionItem>> {
    if (!this.settingsService.getEffectiveGeminiKey()) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: NO_KEY } };
    }
    const prefs = this.prefs();
    if (!prefs.privacy.allowCloudAi) return { ok: false, error: { code: 'CONSENT_REQUIRED', message: CLOUD_AI_OFF } };

    const options = parseAskOptions(rawOptions);
    const mode = options.mode ?? this.currentMode ?? 'mock-interview';
    const wantsScreen = options.useScreenContext !== false && !rawOptions?.ignoreScreenContext;
    const activeScreen = wantsScreen && prefs.privacy.allowCloudScreenshots ? this.screenContextManager?.getConfirmed() : null;

    const res = await this.orchestrator.processUtterance({
      text: question,
      isManual: true,
      mode,
      context: options.context,
      sessionId: this.activeSessionId ?? undefined,
      screenshotBase64: activeScreen?.base64,
      answerFormat: options.answerFormat ?? prefs.ai.answerFormat,
      speakingTargetSec: (options.speakingTargetSec ?? prefs.ai.speakingTargetSec) || undefined,
      action: options.action,
      previousAnswer: options.previousAnswer,
      customInstructions: prefs.ai.customInstructions || undefined,
      preparationProfile: this.profileText(),
      requestId: options.requestId,
      onDelta: this.throttledDelta(options.requestId, question),
    });

    if (!res.ok) return res;
    if (!res.value) {
      return { ok: false, error: { code: 'SOURCE_FAILED', message: 'No answer was produced. Rephrase the question and try again.' } };
    }
    return { ok: true, value: res.value };
  }

  /**
   * Analyzes an explicitly captured screenshot with Gemini Vision.
   * Requires a confirmed (or pending, when named) screenshot and the cloud-screenshot permission.
   */
  async analyzeScreenshot(request: ScreenAnalysisRequest & { requestId?: string }): Promise<Result<SuggestionItem>> {
    if (!this.settingsService.getEffectiveGeminiKey()) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: NO_KEY } };
    }
    const prefs = this.prefs();
    if (!prefs.privacy.allowCloudAi || !prefs.privacy.allowCloudScreenshots) {
      return {
        ok: false,
        error: {
          code: 'CONSENT_REQUIRED',
          message: 'Sending screenshots to Gemini is turned off in Settings → Privacy. Turn it on to analyse this screenshot.',
        },
      };
    }

    let screenshot: ScreenshotData | null = null;
    const confirmed = this.screenContextManager?.getConfirmed() ?? null;
    if (request.screenshotId && confirmed?.id === request.screenshotId) screenshot = confirmed;
    // A pending (not yet confirmed) screenshot is never uploaded.
    if (!screenshot) screenshot = confirmed;

    if (!screenshot) {
      return {
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'No screenshot is available for analysis. Please capture and confirm a screenshot first.',
        },
      };
    }

    const mode = request.mode ?? this.currentMode ?? 'mock-interview';
    const res = await this.orchestrator.processUtterance({
      text: request.question,
      isManual: true,
      mode,
      context: request.context,
      sessionId: this.activeSessionId ?? undefined,
      screenshotBase64: screenshot.base64,
      answerFormat: prefs.ai.answerFormat,
      customInstructions: prefs.ai.customInstructions || undefined,
      requestId: request.requestId,
      onDelta: this.throttledDelta(request.requestId, request.question),
    });

    if (!res.ok) return res;
    if (!res.value) {
      return { ok: false, error: { code: 'SOURCE_FAILED', message: 'No analysis was produced. Try asking a more specific question.' } };
    }
    return { ok: true, value: res.value };
  }

  /** Runs a mode tool (summary, flashcards, answer evaluation…) over supplied text or the transcript. */
  async runTool(request: RunToolRequest): Promise<Result<SuggestionItem>> {
    const tool = getModeTool(request.tool);
    if (!tool) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Unknown tool.' } };
    if (!this.settingsService.getEffectiveGeminiKey()) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: NO_KEY } };
    }
    const prefs = this.prefs();
    if (!prefs.privacy.allowCloudAi) return { ok: false, error: { code: 'CONSENT_REQUIRED', message: CLOUD_AI_OFF } };

    const material = (request.input ?? this.getTranscriptText?.(request.sessionId) ?? '').trim();
    const profile = this.profileText();
    if (material.length < 20 && !(tool.id === 'interview-question' && profile)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message:
            tool.input === 'transcript'
              ? 'There is not enough transcript yet. Start a session or open a past one first.'
              : 'Add some text (or record some transcript) for this tool to work on.',
        },
      };
    }

    const requestId = request.requestId ?? `tool_${Date.now()}`;
    const controller = new AbortController();
    this.toolControllers.set(requestId, controller);
    const onDelta = this.throttledDelta(request.requestId, tool.label);
    try {
      const prompt = buildToolPrompt({
        tool,
        // Keep the most recent part when the transcript is very long (bounded prompt size).
        material: (material || 'No transcript yet. Use the preparation profile only.').slice(-24_000),
        profile,
        customInstructions: prefs.ai.customInstructions || undefined,
      });
      const result = await this.track(() =>
        this.client.generate({
          prompt,
          signal: controller.signal,
          onDelta: onDelta ? (acc) => onDelta(streamingBody(acc)) : undefined,
          maxOutputTokens: 3072,
          temperature: 0.3,
          preferredModel: prefs.ai.model || undefined,
        }),
      );
      const parsed = parseAnswer(result.text);
      const item: SuggestionItem = {
        id: `tool_${Date.now()}_${++this.suggestionCounter}`,
        sessionId: request.sessionId || this.activeSessionId || 'tool_query',
        createdAt: new Date().toISOString(),
        type: tool.id === 'action-items' ? 'action_item' : tool.id === 'follow-up-questions' ? 'follow_up' : 'key_point',
        title: parsed.title || tool.label,
        content: parsed.content || result.text,
        source: 'gemini',
        question: tool.label,
        formatType: tool.mode === 'meeting' ? 'meeting' : 'points',
        modelUsed: result.modelUsed,
        tool: tool.id,
        requestId,
      };
      this.onSuggestion(item);
      return { ok: true, value: item };
    } catch (error) {
      const cancelled = error instanceof GeminiError && error.kind === 'cancelled';
      return {
        ok: false,
        error: { code: cancelled ? 'CANCELLED' : 'SOURCE_FAILED', message: describeGeminiError(error) },
      };
    } finally {
      this.toolControllers.delete(requestId);
    }
  }

  /**
   * Explicit connection test. Sends one short request so network/auth problems can be told apart
   * from conversation detection. This is a real (billable) API call, made only on user request.
   */
  async testGeminiConnection(
    customQuestion = 'Reply with one short sentence confirming the connection works.',
  ): Promise<Result<SuggestionItem>> {
    if (!this.settingsService.getEffectiveGeminiKey()) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: NO_KEY } };
    }
    logDiag('AIDiag:Test', 'Executing explicit Gemini test query');
    try {
      const result = await this.track(() =>
        this.client.generate({
          prompt: `${customQuestion}\n\nRespond in plain text, at most 40 words.`,
          maxOutputTokens: 256,
          preferredModel: this.prefs().ai.model || undefined,
        }),
      );
      const item: SuggestionItem = {
        id: `test_sug_${Date.now()}`,
        sessionId: this.activeSessionId || 'test_session',
        createdAt: new Date().toISOString(),
        type: 'answer_tip',
        title: `Connected · ${result.modelUsed}`,
        content: parseAnswer(result.text).content || result.text,
        source: 'test',
        modelUsed: result.modelUsed,
      };
      logDiag('AIDiag:Test', 'Gemini test query succeeded', { modelUsed: result.modelUsed, latencyMs: result.latencyMs });
      return { ok: true, value: item };
    } catch (err) {
      logDiag('AIDiag:Test', 'Gemini test query failed', { error: err instanceof Error ? err.message : String(err) });
      return { ok: false, error: { code: 'SOURCE_FAILED', message: `Gemini test failed: ${describeGeminiError(err)}` } };
    }
  }

  private generateHeuristicSuggestion(
    transcriptText: string,
    intent: DetectedIntent,
    fallbackReason?: string,
  ): void {
    const lower = transcriptText.toLowerCase();

    let suggestion: {
      type: 'answer_tip' | 'action_item' | 'key_point' | 'follow_up';
      title: string;
      content: string;
    };

    if (intent.isQuestion) {
      if (lower.includes('project') || lower.includes('background') || lower.includes('experience')) {
        suggestion = {
          type: 'answer_tip',
          title: 'Use STAR Framework',
          content: 'Structure your response: Situation, Task, Action you specifically took, and measurable Results.',
        };
      } else if (lower.includes('distributed') || lower.includes('database') || lower.includes('scale')) {
        suggestion = {
          type: 'answer_tip',
          title: 'Distributed System Architecture',
          content: 'Address consistency vs availability (CAP), data partitioning (sharding), replication strategies, and failure detection.',
        };
      } else if (lower.includes('trade-off') || lower.includes('decision') || lower.includes('why')) {
        suggestion = {
          type: 'answer_tip',
          title: 'Technical Decision Framework',
          content: 'State requirements and constraints, evaluate 2 viable alternatives, explain why the chosen approach wins, and note monitored metrics.',
        };
      } else {
        suggestion = {
          type: 'answer_tip',
          title: 'Structured Answer Framework',
          content: 'Direct answer in 1 sentence, explain mechanism with technical terminology, then highlight real-world edge cases.',
        };
      }
    } else if (this.currentMode === 'mock-interview') {
      if (lower.includes('project') || lower.includes('background') || lower.includes('experience')) {
        suggestion = {
          type: 'answer_tip',
          title: 'Use STAR Framework',
          content: 'Structure your response: Situation, Task, Action you specifically took, and measurable Results.',
        };
      } else {
        suggestion = {
          type: 'key_point',
          title: 'Technical Depth',
          content: 'Explain why the architecture was designed that way and what bottleneck you had to optimize for.',
        };
      }
    } else {
      suggestion = {
        type: 'action_item',
        title: 'Meeting Takeaway',
        content: 'Identify actionable decisions, assign explicit owners, and confirm delivery timeline.',
      };
    }

    if (fallbackReason) {
      suggestion.title = `[Heuristic] ${suggestion.title}`;
    }

    this.emit({
      ...suggestion,
      source: 'heuristic',
      isQuestion: intent.isQuestion,
    });
  }

  private emit(
    item:
      | SuggestionItem
      | {
          type: 'answer_tip' | 'action_item' | 'key_point' | 'follow_up';
          title: string;
          content: string;
          source?: 'gemini' | 'heuristic' | 'test';
          isQuestion?: boolean;
          question?: string;
          formatType?: 'direct' | 'technical' | 'interview' | 'star' | 'followup' | 'meeting' | 'points';
          modelUsed?: string;
        },
  ): void {
    if ('sessionId' in item && 'id' in item) {
      logDiag('AIDiag:07-Delivery', 'Emitting pre-formed suggestion to UI and session store', {
        id: item.id,
        title: item.title,
        source: item.source,
      });
      this.onSuggestion(item as SuggestionItem);
      return;
    }

    if (!this.activeSessionId) return;

    const suggestion: SuggestionItem = {
      id: `sug_${Date.now()}_${++this.suggestionCounter}`,
      sessionId: this.activeSessionId,
      createdAt: new Date().toISOString(),
      type: item.type,
      title: item.title,
      content: item.content,
      source: item.source || 'gemini',
      isQuestion: item.isQuestion,
      question: item.question,
      formatType: item.formatType,
      modelUsed: item.modelUsed,
    };

    logDiag('AIDiag:07-Delivery', 'Emitting suggestion to UI and session store', {
      id: suggestion.id,
      title: suggestion.title,
      source: suggestion.source,
    });

    this.onSuggestion(suggestion);
  }

  destroy(): void {
    this.cancel();
    this.client.abortAll();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
