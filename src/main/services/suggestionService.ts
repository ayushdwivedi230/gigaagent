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
  private readonly debounceMs: number;
  private readonly minIntervalMs: number;

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
  }

  setSession(sessionId: string | null, mode: SessionMode = 'mock-interview'): void {
    if (this.activeSessionId !== sessionId) {
      this.activeSessionId = sessionId;
      this.currentMode = mode;
      this.accumulatedSegments = [];
      this.suggestionCounter = 0;
      this.lastQueryTimestamp = 0;
      this.lastQueriedText = '';
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

    const questionPatterns = [
      /\?$/,
      /\b(how|what|why|when|where|who|which)\b/i,
      /\b(can you|could you|would you|explain|describe|tell me about|walk me through)\b/i,
      /\b(difference between|trade-offs? between|compare|pros and cons)\b/i,
      /\b(how do you|how would you|what is the best way to)\b/i,
    ];

    const isQuestion =
      last.speaker === 'system' || questionPatterns.some((pattern) => pattern.test(combined));

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
        await this.queryGemini(apiKey, recentText, intent);
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
    // If active confirmed screen context exists and not explicitly ignored, route to analyzeScreenshot
    if (!options?.ignoreScreenContext && this.screenContextManager?.hasContext()) {
      return this.analyzeScreenshot({
        question,
        mode: options?.mode,
        context: options?.context,
      });
    }

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
    const recentContext =
      options?.context ??
      this.accumulatedSegments
        .slice(-6)
        .map((s) => `${s.speaker === 'system' ? 'Meeting/Interviewer' : 'You'}: ${s.text}`)
        .join('\n')
        .trim();

    logDiag('AIDiag:AskAi', 'Executing Ask AI query', { question, mode, hasContext: Boolean(recentContext) });

    let modeInstruction = '';
    if (mode === 'mock-interview') {
      modeInstruction = `Role: Technical Interview Candidate Copilot.
Provide a high-scoring, articulate response:
1. Direct Answer (1-2 sentences delivering the core concept immediately).
2. Key Points / STAR Breakdown (3-4 crisp bullet points detailing mechanism, implementation, or trade-offs).
3. Edge Case / Pro-Tip (1 sentence on production considerations or best practices).`;
    } else if (mode === 'meeting') {
      modeInstruction = `Role: Strategic Meeting Copilot.
Provide a concise, high-impact contribution:
1. Executive Summary / Position (1-2 clear sentences).
2. Key Talking Points & Action Items (3-4 crisp bullets).
3. Strategic Considerations (Key risks or next steps).`;
    } else {
      modeInstruction = `Role: Expert Technical Copilot.
Provide an authoritative, clear breakdown:
1. Core Explanation (1-2 sentences summarizing the concept).
2. Key Differences / Bulleted Details (3-4 concise points).
3. Practical Takeaway or Example.`;
    }

    const systemPrompt = `${modeInstruction}

${recentContext ? `Recent Conversation Context:\n${recentContext}\n` : ''}
Question / Prompt:
"${question}"

Return ONLY a valid JSON object matching this schema:
{
  "title": "Concise topic title (under 40 chars)",
  "formatType": "technical",
  "content": "Full formatted response using standard Markdown (bullet points, bold highlights, concise paragraphs). Keep it under 600 characters so it can be read in 20 seconds."
}`;

    try {
      const { text, modelUsed } = await this.dispatchGeminiRequest(apiKey, systemPrompt);
      const parsed = this.parseGeminiJson(text);

      const item: SuggestionItem = {
        id: `ask_${Date.now()}_${++this.suggestionCounter}`,
        sessionId: this.activeSessionId || 'manual_query',
        createdAt: new Date().toISOString(),
        type: 'answer_tip',
        title: parsed.title || 'AI Answer',
        content: parsed.content || text,
        source: 'gemini',
        isQuestion: true,
        question,
        formatType:
          (parsed.formatType as any) ||
          (mode === 'mock-interview' ? 'interview' : mode === 'meeting' ? 'meeting' : 'technical'),
        modelUsed,
      };

      logDiag('AIDiag:AskAi', 'Ask AI query completed successfully', {
        id: item.id,
        modelUsed,
        title: item.title,
      });

      this.emit(item);
      return { ok: true, value: item };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDiag('AIDiag:AskAi', 'Ask AI query failed', { error: errMsg });
      return {
        ok: false,
        error: {
          code: 'SOURCE_FAILED',
          message: `AI generation failed: ${errMsg}`,
        },
      };
    }
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
    const recentContext =
      request.context ??
      this.accumulatedSegments
        .slice(-6)
        .map((s) => `${s.speaker === 'system' ? 'Meeting/Interviewer' : 'You'}: ${s.text}`)
        .join('\n')
        .trim();

    const turns = this.screenContextManager?.getTurns() ?? [];
    const turnHistoryText =
      turns.length > 0
        ? `Prior Visual Q&A Turns on this screen:\n${turns
            .map((t, idx) => `Turn ${idx + 1}:\nQ: ${t.question}\nA: ${t.answer}`)
            .join('\n\n')}\n`
        : '';

    logDiag('AIDiag:Vision', 'Analyzing screenshot with Gemini Vision', {
      question: request.question,
      screenshotId: screenshot.id,
      turnsCount: turns.length,
      mode,
    });

    const systemPrompt = `You are GigaAgent, an elite real-time desktop AI copilot with multimodal screen intelligence.
You are assisting the user during a ${mode}.
Analyze the attached high-resolution screen image with rigorous technical accuracy.

The screen may display:
- Code editor / IDE (source code, syntax/runtime bugs, stack traces, compiler output)
- Coding problems (LeetCode, HackerRank, DSA challenges, constraints, input/output examples)
- Terminal / command line output (errors, logs, git operations, deployment issues)
- Architecture diagrams, system designs, UML schemas, flowcharts
- Web applications, responsive UI layouts, CSS/HTML structures
- Tables, financial metrics, technical documentation, spreadsheets

Instructions:
1. Direct Answer: Answer the user's specific question or instruction authoritatively.
2. If code/debugging: Pinpoint the exact root cause, line number(s), and provide the clean, corrected code in a markdown code block (\`\`\`<lang> ... \`\`\`).
3. If DSA problem: Provide the optimal algorithmic approach, time and space complexity in Big-O notation, key edge cases, and concise implementation.
4. If Architecture/Diagram: Deconstruct components, message flow, bottlenecks, and single points of failure.
5. If UI/Design: Provide actionable suggestions for accessibility, layout hierarchy, and responsive CSS.
6. Format cleanly using standard Markdown: bold highlights, bullet points, and code blocks.

${turnHistoryText}
${recentContext ? `Recent Conversation Transcript:\n${recentContext}\n` : ''}
User Question / Instruction:
"${request.question}"

Return ONLY a valid JSON object matching this schema:
{
  "title": "Concise topic title (under 40 chars)",
  "formatType": "technical",
  "content": "Comprehensive markdown response with bold highlights, bullet points, and code fences. Ensure code snippets are complete and runnable."
}`;

    try {
      const { text, modelUsed } = await this.dispatchGeminiVisionRequest(
        apiKey,
        systemPrompt,
        screenshot.base64,
      );
      const parsed = this.parseGeminiJson(text);

      const content = parsed.content || text;
      const title = parsed.title || 'Screen Intelligence';

      // Record in multi-turn history
      this.screenContextManager?.addTurn(request.question, content);

      const item: SuggestionItem = {
        id: `vis_${Date.now()}_${++this.suggestionCounter}`,
        sessionId: this.activeSessionId || 'screen_query',
        createdAt: new Date().toISOString(),
        type: 'answer_tip',
        title,
        content,
        source: 'gemini',
        isQuestion: true,
        question: request.question,
        formatType:
          (parsed.formatType as any) ||
          (mode === 'mock-interview' ? 'interview' : 'technical'),
        modelUsed,
        hasVisualContext: true,
      };

      logDiag('AIDiag:Vision', 'Gemini Vision analysis completed successfully', {
        id: item.id,
        modelUsed,
        title: item.title,
      });

      this.emit(item);
      return { ok: true, value: item };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDiag('AIDiag:Vision', 'Gemini Vision analysis failed', { error: errMsg });
      return {
        ok: false,
        error: {
          code: 'SOURCE_FAILED',
          message: `Screen analysis failed: ${errMsg}`,
        },
      };
    }
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

    for (const model of candidateModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      try {
        const response = await fetch(url, {
          method: 'POST',
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
            `Vision model ${model} returned HTTP ${response.status}, trying next candidate...`,
            {
              model,
              status: response.status,
              details: errBody.slice(0, 100),
            },
          );
          lastError = new Error(
            `Vision model ${model} returned HTTP ${response.status}: ${errBody.slice(0, 100)}`,
          );
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

    for (const model of candidateModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      try {
        const response = await fetch(url, {
          method: 'POST',
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
          logDiag('AIDiag:ModelFallback', `Model ${model} returned HTTP ${response.status}, trying next candidate...`, {
            model,
            status: response.status,
            details: errBody.slice(0, 100),
          });
          lastError = new Error(`Model ${model} returned HTTP ${response.status}: ${errBody.slice(0, 100)}`);
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
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
