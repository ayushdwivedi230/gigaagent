import type { Result, SessionMode, SuggestionItem, TranscriptSegment } from '@shared/types';
import type { SettingsService } from './settingsService';
import { logDiag } from './diagnosticsLogger';

export interface SuggestionServiceOptions {
  settingsService: SettingsService;
  onSuggestion: (suggestion: SuggestionItem) => void;
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

    logDiag('AIDiag:04-Request', 'Dispatching request to Gemini API', {
      isQuestion: intent.isQuestion,
    });

    const startTime = Date.now();
    const { text: rawText, modelUsed } = await this.dispatchGeminiRequest(apiKey, systemPrompt);
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
      });
    }
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
  } {
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      return JSON.parse(cleaned) as {
        type?: 'answer_tip' | 'action_item' | 'key_point' | 'follow_up';
        title?: string;
        content?: string;
      };
    } catch {
      // Extract first JSON block if surrounded by explanatory text
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]) as {
            type?: 'answer_tip' | 'action_item' | 'key_point' | 'follow_up';
            title?: string;
            content?: string;
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

  private emit(item: {
    type: 'answer_tip' | 'action_item' | 'key_point' | 'follow_up';
    title: string;
    content: string;
    source?: 'gemini' | 'heuristic' | 'test';
    isQuestion?: boolean;
  }): void {
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
