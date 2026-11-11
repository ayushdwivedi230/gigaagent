import type {
  Result,
  ScreenAnalysisRequest,
  ScreenshotData,
  SessionMode,
  SuggestionItem,
  TranscriptSegment,
} from '@shared/types';
import type { SettingsService } from './settingsService';
import type { ScreenContextManager } from './screenContextManager';
import { ResponseOrchestrator } from './intelligence/responseOrchestrator';
import { logDiag } from './diagnosticsLogger';

export interface SuggestionServiceOptions {
  settingsService: SettingsService;
  onSuggestion: (suggestion: SuggestionItem) => void;
  screenContextManager?: ScreenContextManager;
  debounceMs?: number;
  minIntervalMs?: number;
}

export interface DetectedIntent {
  isQuestion: boolean;
  questionText: string;
  speaker: 'user' | 'system';
  topic: string;
}

export class SuggestionService {
  private readonly settingsService: SettingsService;
  private readonly onSuggestion: (suggestion: SuggestionItem) => void;
  private readonly screenContextManager?: ScreenContextManager;
  private readonly orchestrator: ResponseOrchestrator;
  private readonly debounceMs: number;
  private readonly minIntervalMs: number;
  private readonly activeAbortControllers: Set<AbortController> = new Set();

  private activeSessionId: string | null = null;
  private currentMode: SessionMode = 'mock-interview';
  private accumulatedSegments: TranscriptSegment[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private suggestionCounter = 0;
  private isProcessing = false;
  private lastQueryTimestamp = 0;
  private lastQueriedText = '';

  constructor(options: SuggestionServiceOptions) {
    this.settingsService = options.settingsService;
    this.onSuggestion = options.onSuggestion;
    this.screenContextManager = options.screenContextManager;
    this.debounceMs = options.debounceMs ?? 2000;
    this.minIntervalMs = options.minIntervalMs ?? 6000; // 6s cooldown for faster response while respecting quota

    this.orchestrator = new ResponseOrchestrator({
      onEmitSuggestion: (item) => this.emit(item),
      geminiRequester: async (prompt, screenBase64) => {
        const apiKey = this.settingsService.getEffectiveGeminiKey();
        if (!apiKey) {
          throw new Error('No Gemini API key is configured.');
        }
        if (screenBase64) {
          return this.dispatchGeminiVisionRequest(apiKey, prompt, screenBase64);
        }
        return this.dispatchGeminiRequest(apiKey, prompt);
      },
    });
  }

  getOrchestrator(): ResponseOrchestrator {
    return this.orchestrator;
  }

  setSession(sessionId: string | null, mode: SessionMode = 'mock-interview'): void {
    if (this.activeSessionId !== sessionId || this.currentMode !== mode) {
      this.activeSessionId = sessionId;
      this.currentMode = mode;
      this.accumulatedSegments = [];
      this.suggestionCounter = 0;
      this.lastQueryTimestamp = 0;
      this.lastQueriedText = '';
      this.orchestrator.setSession(sessionId, mode);
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      logDiag('AIDiag:01-Session', 'Active session updated in SuggestionService', {
        sessionId,
        mode,
      });
    }
  }

  handleSegment(segment: TranscriptSegment): void {
    if (!this.activeSessionId || segment.sessionId !== this.activeSessionId) return;
    if (!segment.isFinal) return;

    this.accumulatedSegments.push(segment);

    const intent = this.detectQuestionAndIntent([segment]);
    logDiag('AIDiag:01-Segment', 'Final segment received', {
      segmentId: segment.id,
      speaker: segment.speaker,
      text: segment.text,
      isQuestion: intent.isQuestion,
    });

    // If an interviewer/system participant asks a question, shorten debounce for instant copilot assistance
    const delay = intent.isQuestion && segment.speaker === 'system' ? 800 : this.debounceMs;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

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
      (detection.isQuestionOrInstruction || last.speaker === 'system') &&
      intentMeta.intent !== 'ACKNOWLEDGEMENT';

    return {
      isQuestion,
      questionText: isQuestion ? combined : '',
      speaker: last.speaker,
      topic: this.currentMode,
    };
  }

  private async generateSuggestion(): Promise<void> {
    if (this.isProcessing || !this.activeSessionId || this.accumulatedSegments.length === 0) return;

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
      .map((s) => `${s.speaker === 'system' ? '[Interviewer/Meeting]' : '[Candidate/You]'}: ${s.text}`)
      .join('\n')
      .trim();

    if (recentText.length < 15 || recentText === this.lastQueriedText) {
      return;
    }

    this.isProcessing = true;
    this.lastQueryTimestamp = now;
    this.lastQueriedText = recentText;

    const intent = this.detectQuestionAndIntent(recentSegments);
    logDiag('AIDiag:02-Intent', 'Utterance analysis complete', {
      isQuestion: intent.isQuestion,
      speaker: intent.speaker,
      segmentsAnalyzed: recentSegments.length,
    });

    try {
      const apiKey = this.settingsService.getEffectiveGeminiKey();
      logDiag('AIDiag:03-Auth', 'Checking Gemini authentication', {
        hasKey: Boolean(apiKey),
        keyPrefix: apiKey ? apiKey.slice(0, 5) : 'none',
      });

      if (apiKey) {
        const activeScreen = this.screenContextManager?.getConfirmed();
        await this.orchestrator.processUtterance({
          text: lastSeg.text,
          speaker: lastSeg.speaker,
          mode: this.currentMode,
          context: recentText,
          sessionId: this.activeSessionId ?? undefined,
          screenshotBase64: activeScreen?.base64,
        });
      } else {
        logDiag('AIDiag:Fallback', 'No Gemini API key configured, generating heuristic suggestion');
        this.generateHeuristicSuggestion(recentText, intent);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDiag('AIDiag:Fallback', 'Gemini query failed, falling back to heuristic', {
        error: errMsg,
      });
      console.warn('[SuggestionService] Gemini query failed:', errMsg);
      this.generateHeuristicSuggestion(recentText, intent, errMsg);
    } finally {
      this.isProcessing = false;
    }
  }

  private async queryGemini(
    apiKey: string,
    transcriptText: string,
    intent: DetectedIntent,
  ): Promise<void> {
    const isInterview = this.currentMode === 'mock-interview';

    const systemPrompt = `You are GigaAgent, an elite real-time copilot for a live ${this.currentMode}.
Your job is to provide actionable, technically rigorous, highly relevant answers and talking points for the user.

Conversation Context:
${transcriptText}

Task:
${
  intent.isQuestion
    ? `The conversation contains a question or discussion point. Provide a DIRECT, high-impact technical response outline that the user can speak immediately. Give the core answer first, followed by 2-3 key technical talking points or trade-offs.`
    : `Provide ONE high-value tactical insight or coaching point based on what was just said.`
}

Return ONLY a valid JSON object matching this schema:
{
  "type": "${intent.isQuestion ? 'answer_tip' : 'key_point'}",
  "title": "Clear, informative title (under 35 chars)",
  "content": "Actionable, concrete talking points or direct answer (2-4 clear sentences with technical depth, under 300 chars)"
}`;

    const activeScreen = this.screenContextManager?.getConfirmed();
    const hasVision = Boolean(activeScreen);

    logDiag('AIDiag:04-Request', 'Dispatching request to Gemini API', {
      isQuestion: intent.isQuestion,
      hasVision,
    });

    const startTime = Date.now();
    let rawText = '';
    let modelUsed = '';

    if (activeScreen) {
      const visionPrompt = `${systemPrompt}\n\nNote: A confirmed screenshot of the user's screen is attached. Relate your response directly to what is on screen if relevant.`;
      const res = await this.dispatchGeminiVisionRequest(apiKey, visionPrompt, activeScreen.base64);
      rawText = res.text;
      modelUsed = res.modelUsed;
    } else {
      const res = await this.dispatchGeminiRequest(apiKey, systemPrompt);
      rawText = res.text;
      modelUsed = res.modelUsed;
    }
    const latencyMs = Date.now() - startTime;

    logDiag('AIDiag:05-Response', 'Gemini response received', {
      modelUsed,
      latencyMs,
      hasText: Boolean(rawText),
      preview: rawText?.slice(0, 80),
    });

    const parsed = this.parseGeminiJson(rawText);
    logDiag('AIDiag:06-Parse', 'Parsed Gemini JSON output', {
      modelUsed,
      type: parsed.type,
      title: parsed.title,
    });

    if (parsed.title && parsed.content) {
      this.emit({
        type: parsed.type || (intent.isQuestion ? 'answer_tip' : 'key_point'),
        title: parsed.title,
        content: parsed.content,
        source: 'gemini',
        isQuestion: intent.isQuestion,
        question: intent.questionText || undefined,
        formatType: isInterview ? 'interview' : 'technical',
        modelUsed,
      });
    }
  }

  /**
   * One-click or manual Ask AI functionality.
   * Generates a direct, highly structured response using the user's question,
   * active mode, and recent conversation context.
   */
  async askQuestion(
    question: string,
    options?: {
      mode?: SessionMode;
      context?: string;
      formatType?: string;
      ignoreScreenContext?: boolean;
    },
  ): Promise<Result<SuggestionItem>> {
    const apiKey = this.settingsService.getEffectiveGeminiKey();
    if (!apiKey) {
      return {
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'No Gemini API key is configured. Please enter your Gemini API Key in Settings.',
        },
      };
    }

    const mode = options?.mode ?? this.currentMode ?? 'mock-interview';
    const activeScreen = !options?.ignoreScreenContext
      ? this.screenContextManager?.getConfirmed()
      : null;

    const res = await this.orchestrator.processUtterance({
      text: question,
      isManual: true,
      mode,
      context: options?.context,
      sessionId: this.activeSessionId ?? undefined,
      screenshotBase64: activeScreen?.base64,
    });

    if (!res.ok) return res;
    if (!res.value) {
      return {
        ok: true,
        value: {
          id: `dup_${Date.now()}`,
          sessionId: this.activeSessionId || 'manual_query',
          createdAt: new Date().toISOString(),
          type: 'answer_tip',
          title: 'Duplicate Query',
          content: 'This question was already answered recently.',
          source: 'gemini',
        },
      };
    }
    return { ok: true, value: res.value };
  }

  /**
   * Analyzes an explicitly captured screenshot with Gemini Vision.
   * Multi-turn aware: keeps previous questions and answers in conversation history.
   */
  async analyzeScreenshot(request: ScreenAnalysisRequest): Promise<Result<SuggestionItem>> {
    const apiKey = this.settingsService.getEffectiveGeminiKey();
    if (!apiKey) {
      return {
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'No Gemini API key is configured. Please enter your Gemini API Key in Settings.',
        },
      };
    }

    let screenshot: ScreenshotData | null = null;
    if (request.screenshotId) {
      if (this.screenContextManager?.getConfirmed()?.id === request.screenshotId) {
        screenshot = this.screenContextManager.getConfirmed();
      } else if (this.screenContextManager?.getPending()?.id === request.screenshotId) {
        screenshot = this.screenContextManager.getPending();
      }
    }

    if (!screenshot) {
      screenshot =
        this.screenContextManager?.getConfirmed() ??
        this.screenContextManager?.getPending() ??
        null;
    }

    if (!screenshot) {
      return {
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message:
            'No screenshot is available for analysis. Please capture and confirm a screenshot first.',
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
    });

    if (!res.ok) return res;
    if (!res.value) {
      return {
        ok: true,
        value: {
          id: `vis_dup_${Date.now()}`,
          sessionId: this.activeSessionId || 'screen_query',
          createdAt: new Date().toISOString(),
          type: 'answer_tip',
          title: 'Screen Analysis',
          content: 'This screen question was recently analyzed.',
          source: 'gemini',
          hasVisualContext: true,
        },
      };
    }
    return { ok: true, value: res.value };
  }

  private createManagedAbortController(timeoutMs: number): AbortController {
    const controller = new AbortController();
    this.activeAbortControllers.add(controller);
    const timer = setTimeout(() => {
      controller.abort(new Error(`Gemini request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    controller.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      this.activeAbortControllers.delete(controller);
    });
    return controller;
  }

  private abortAllRequests(): void {
    for (const controller of this.activeAbortControllers) {
      try {
        controller.abort(new Error('Request cancelled by user or session shutdown.'));
      } catch {}
    }
    this.activeAbortControllers.clear();
  }

  /**
   * Dispatches multimodal generateContent request with automatic fallback across vision-capable models.
   */
  private async dispatchGeminiVisionRequest(
    apiKey: string,
    prompt: string,
    base64Image: string,
  ): Promise<{ text: string; modelUsed: string }> {
    const candidateModels = [
      'gemini-flash-lite-latest',
      'gemini-3.5-flash-lite',
      'gemini-flash-latest',
      'gemini-3.8-flash',
    ];
    let lastError: Error | null = null;
    let attempt = 0;

    for (const model of candidateModels) {
      attempt++;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const controller = this.createManagedAbortController(20000);
      try {
        const response = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: base64Image,
                    },
                  },
                  {
                    text: prompt,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 2048,
              responseMimeType: 'application/json',
            },
          }),
        });

        if (response.status === 404 || response.status === 503 || response.status === 429) {
          const errBody = await response.text().catch(() => '');
          logDiag(
            'AIDiag:ModelFallback',
            `Vision model ${model} returned HTTP ${response.status}, applying backoff...`,
            {
              model,
              status: response.status,
              details: errBody.slice(0, 100),
            },
          );
          lastError = new Error(
            `Vision model ${model} returned HTTP ${response.status}: ${errBody.slice(0, 100)}`,
          );
          // Apply exponential backoff for rate limits or server overload
          if (response.status === 429 || response.status === 503) {
            await new Promise((r) => setTimeout(r, Math.min(2000, 500 * attempt)));
          }
          continue;
        }

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          throw new Error(
            `Gemini Vision HTTP ${response.status} (${response.statusText}): ${errBody.slice(0, 150)}`,
          );
        }

        const data = (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string }>;
            };
          }>;
        };

        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          throw new Error(`Gemini Vision returned empty candidate content for ${model}`);
        }

        return { text: rawText, modelUsed: model };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.message;
        if (msg.includes('404') || msg.includes('503') || msg.includes('429')) {
          continue;
        }
        throw lastError;
      }
    }

    throw lastError || new Error('No supported Gemini Vision model found on endpoints.');
  }

  /**
   * Dispatches generateContent request with automatic fallback across supported model versions
   * (e.g. gemini-flash-lite-latest -> gemini-3.5-flash-lite -> gemini-flash-latest -> gemini-3.8-flash)
   * to guard against model deprecations and temporary demand spikes.
   */
  private async dispatchGeminiRequest(
    apiKey: string,
    prompt: string,
  ): Promise<{ text: string; modelUsed: string }> {
    const candidateModels = [
      'gemini-flash-lite-latest',
      'gemini-3.5-flash-lite',
      'gemini-flash-latest',
      'gemini-3.8-flash',
    ];
    let lastError: Error | null = null;
    let attempt = 0;

    for (const model of candidateModels) {
      attempt++;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const controller = this.createManagedAbortController(15000);
      try {
        const response = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 1024,
              responseMimeType: 'application/json',
            },
          }),
        });

        if (response.status === 404 || response.status === 503 || response.status === 429) {
          const errBody = await response.text().catch(() => '');
          logDiag('AIDiag:ModelFallback', `Model ${model} returned HTTP ${response.status}, applying backoff...`, {
            model,
            status: response.status,
            details: errBody.slice(0, 100),
          });
          lastError = new Error(`Model ${model} returned HTTP ${response.status}: ${errBody.slice(0, 100)}`);
          if (response.status === 429 || response.status === 503) {
            await new Promise((r) => setTimeout(r, Math.min(2000, 500 * attempt)));
          }
          continue;
        }

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          throw new Error(`Gemini HTTP ${response.status} (${response.statusText}): ${errBody.slice(0, 150)}`);
        }

        const data = (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string }>;
            };
          }>;
        };

        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          throw new Error(`Gemini returned empty candidate content for ${model}`);
        }

        return { text: rawText, modelUsed: model };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.message;
        if (msg.includes('404') || msg.includes('503') || msg.includes('429')) {
          continue;
        }
        throw lastError;
      }
    }

    throw lastError || new Error('No supported Gemini model found on endpoints.');
  }

  /**
   * Explicit test action for user or diagnostic verification.
   * Directly queries Gemini with a known technical question to isolate network/auth from conversation detection.
   */
  async testGeminiConnection(
    customQuestion = 'Explain how Raft consensus handles leader election during a network partition.',
  ): Promise<Result<SuggestionItem>> {
    const apiKey = this.settingsService.getEffectiveGeminiKey();
    if (!apiKey) {
      return {
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'No Gemini API key is configured. Please enter your Gemini API Key in Settings.',
        },
      };
    }

    logDiag('AIDiag:Test', 'Executing explicit Gemini test query', { question: customQuestion });

    try {
      const prompt = `You are a real-time copilot. Answer this technical question directly with structured key points:
"${customQuestion}"

Return ONLY a valid JSON object matching this schema:
{
  "type": "answer_tip",
  "title": "Concise title",
  "content": "Direct technical answer with 2-3 key talking points (under 280 chars)"
}`;

      const { text, modelUsed } = await this.dispatchGeminiRequest(apiKey, prompt);
      const parsed = this.parseGeminiJson(text);

      const item: SuggestionItem = {
        id: `test_sug_${Date.now()}`,
        sessionId: this.activeSessionId || 'test_session',
        createdAt: new Date().toISOString(),
        type: 'answer_tip',
        title: `[${modelUsed}] ${parsed.title || 'Technical Response'}`,
        content: parsed.content || 'Successfully verified Gemini connection.',
        source: 'gemini',
        isQuestion: true,
      };

      logDiag('AIDiag:Test', 'Gemini test query succeeded', {
        modelUsed,
        title: item.title,
        content: item.content,
      });

      this.onSuggestion(item);
      return { ok: true, value: item };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logDiag('AIDiag:Test', 'Gemini test query failed', { error: msg });
      return {
        ok: false,
        error: { code: 'SOURCE_FAILED', message: `Gemini test failed: ${msg}` },
      };
    }
  }

  private parseGeminiJson(rawText: string): {
    type?: 'answer_tip' | 'action_item' | 'key_point' | 'follow_up';
    title?: string;
    content?: string;
    formatType?: string;
  } {
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      let parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
        parsed = parsed[0];
      }
      return parsed as {
        type?: 'answer_tip' | 'action_item' | 'key_point' | 'follow_up';
        title?: string;
        content?: string;
        formatType?: string;
      };
    } catch {
      // Extract first JSON block if surrounded by explanatory text
      const match = rawText.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (match) {
        try {
          let parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
            parsed = parsed[0];
          }
          return parsed as {
            type?: 'answer_tip' | 'action_item' | 'key_point' | 'follow_up';
            title?: string;
            content?: string;
            formatType?: string;
          };
        } catch {}
      }
      return {
        type: 'answer_tip',
        title: 'Technical Copilot Tip',
        content: rawText.slice(0, 250),
      };
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
    this.abortAllRequests();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
