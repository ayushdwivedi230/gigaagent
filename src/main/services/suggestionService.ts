import type { SessionMode, SuggestionItem, TranscriptSegment } from '@shared/types';
import type { SettingsService } from './settingsService';

export interface SuggestionServiceOptions {
  settingsService: SettingsService;
  onSuggestion: (suggestion: SuggestionItem) => void;
  debounceMs?: number;
}

export class SuggestionService {
  private readonly settingsService: SettingsService;
  private readonly onSuggestion: (suggestion: SuggestionItem) => void;
  private readonly debounceMs: number;

  private activeSessionId: string | null = null;
  private currentMode: SessionMode = 'mock-interview';
  private accumulatedSegments: TranscriptSegment[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private suggestionCounter = 0;
  private isProcessing = false;

  constructor(options: SuggestionServiceOptions) {
    this.settingsService = options.settingsService;
    this.onSuggestion = options.onSuggestion;
    this.debounceMs = options.debounceMs ?? 2500;
  }

  setSession(sessionId: string | null, mode: SessionMode = 'mock-interview'): void {
    if (this.activeSessionId !== sessionId) {
      this.activeSessionId = sessionId;
      this.currentMode = mode;
      this.accumulatedSegments = [];
      this.suggestionCounter = 0;
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
    }
  }

  handleSegment(segment: TranscriptSegment): void {
    if (!this.activeSessionId || segment.sessionId !== this.activeSessionId) return;
    if (!segment.isFinal) return;

    this.accumulatedSegments.push(segment);

    // Debounce to allow full speaker thoughts before querying suggestions
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      void this.generateSuggestion();
    }, this.debounceMs);
  }

  private async generateSuggestion(): Promise<void> {
    if (this.isProcessing || !this.activeSessionId || this.accumulatedSegments.length === 0) return;

    this.isProcessing = true;

    try {
      const recentText = this.accumulatedSegments
        .slice(-5)
        .map((s) => s.text)
        .join(' ');

      if (recentText.trim().length < 15) {
        return;
      }

      const apiKey = this.settingsService.getEffectiveGeminiKey();
      if (apiKey) {
        await this.queryGemini(apiKey, recentText);
      } else {
        this.generateHeuristicSuggestion(recentText);
      }
    } catch (err) {
      console.warn('[SuggestionService] Suggestion generation error', err);
    } finally {
      this.isProcessing = false;
    }
  }

  private async queryGemini(apiKey: string, transcriptText: string): Promise<void> {
    const prompt = `You are a real-time copilot for a desktop assistant in "${this.currentMode}" mode.
Based on the following recent conversation snippet, provide ONE concise, high-value, actionable suggestion or tip for the user.

Conversation snippet:
"${transcriptText}"

Return ONLY a valid JSON object with the following schema:
{
  "type": "answer_tip" | "action_item" | "key_point" | "follow_up",
  "title": "Short title (under 30 chars)",
  "content": "One or two concise, punchy sentences of guidance (under 160 chars)"
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 200,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return;

    const parsed = JSON.parse(text) as {
      type?: 'answer_tip' | 'action_item' | 'key_point' | 'follow_up';
      title?: string;
      content?: string;
    };

    if (parsed.title && parsed.content) {
      this.emit({
        type: parsed.type || 'answer_tip',
        title: parsed.title,
        content: parsed.content,
      });
    }
  }

  private generateHeuristicSuggestion(transcriptText: string): void {
    const lower = transcriptText.toLowerCase();

    let suggestion: {
      type: 'answer_tip' | 'action_item' | 'key_point' | 'follow_up';
      title: string;
      content: string;
    };

    if (this.currentMode === 'mock-interview') {
      if (lower.includes('project') || lower.includes('background') || lower.includes('experience')) {
        suggestion = {
          type: 'answer_tip',
          title: 'Use STAR Framework',
          content: 'Structure your response: Situation, Task, Action you specifically took, and measurable Results.',
        };
      } else if (lower.includes('trade-off') || lower.includes('hard') || lower.includes('decide')) {
        suggestion = {
          type: 'answer_tip',
          title: 'Explain Decision Criteria',
          content: 'Highlight the constraints, alternatives considered, metrics evaluated, and why the final compromise was chosen.',
        };
      } else if (lower.includes('disagree') || lower.includes('feedback') || lower.includes('conflict')) {
        suggestion = {
          type: 'answer_tip',
          title: 'Emphasize Curiosity',
          content: 'Mention seeking data to validate differing perspectives and aligning on business objectives rather than personal opinions.',
        };
      } else {
        suggestion = {
          type: 'key_point',
          title: 'Be Concise & Impactful',
          content: 'Keep answers under 2 minutes and conclude with the tangible impact on customers or the team.',
        };
      }
    } else if (this.currentMode === 'meeting') {
      if (lower.includes('action') || lower.includes('will') || lower.includes('todo') || lower.includes('next')) {
        suggestion = {
          type: 'action_item',
          title: 'Capture Action Item',
          content: 'Confirm the owner, deliverable, and target completion date before moving to the next agenda item.',
        };
      } else {
        suggestion = {
          type: 'key_point',
          title: 'Executive Summary',
          content: 'Summarize key decisions reached so far to ensure consensus across all participants.',
        };
      }
    } else {
      suggestion = {
        type: 'follow_up',
        title: 'Concept Review',
        content: 'Identify the underlying fundamental principles and test understanding with a real-world edge case.',
      };
    }

    this.emit(suggestion);
  }

  private emit(item: {
    type: 'answer_tip' | 'action_item' | 'key_point' | 'follow_up';
    title: string;
    content: string;
  }): void {
    if (!this.activeSessionId) return;

    this.onSuggestion({
      id: `sug_${Date.now()}_${++this.suggestionCounter}`,
      sessionId: this.activeSessionId,
      createdAt: new Date().toISOString(),
      type: item.type,
      title: item.title,
      content: item.content,
    });
  }

  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
