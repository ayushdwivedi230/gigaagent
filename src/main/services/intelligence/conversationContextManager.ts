import type { ContextSnapshot, ConversationTurn, IntentMetadata } from './types';
import { logDiag } from '../diagnosticsLogger';

export class ConversationContextManager {
  private turns: ConversationTurn[] = [];
  private activeTopic: string | null = null;
  private primaryLanguage: string | null = null;
  private importantEntities: Map<string, string> = new Map();
  private unresolvedQuestions: string[] = [];

  reset(): void {
    this.turns = [];
    this.activeTopic = null;
    this.primaryLanguage = null;
    this.importantEntities.clear();
    this.unresolvedQuestions = [];
    logDiag('ContextManager:Reset', 'Conversation context memory reset');
  }

  addTurn(
    speaker: 'user' | 'system',
    text: string,
    intentMeta?: IntentMetadata,
    aiResponse?: string,
  ): void {
    const turn: ConversationTurn = {
      id: `turn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      speaker,
      text: text.trim(),
      intent: intentMeta?.intent,
      detectedQuestion: intentMeta?.detectedQuestion,
      timestamp: new Date().toISOString(),
      aiResponse: aiResponse?.trim(),
      programmingLanguage: intentMeta?.programmingLanguage,
    };

    this.turns.push(turn);
    if (this.turns.length > 20) {
      this.turns.shift();
    }

    // Update active topic & language
    if (intentMeta) {
      if (intentMeta.programmingLanguage) {
        this.primaryLanguage = intentMeta.programmingLanguage;
      }

      // If this is a new standalone topic (not a follow up), update topic
      if (!intentMeta.isFollowUp && intentMeta.relevantEntities.length > 0) {
        this.activeTopic = intentMeta.relevantEntities.join(', ');
      }

      // Track entities
      for (const ent of intentMeta.relevantEntities) {
        this.importantEntities.set(ent, ent);
      }

      // Question tracking
      if (intentMeta.needsAnswer && !aiResponse) {
        this.unresolvedQuestions.push(intentMeta.detectedQuestion);
      } else if (aiResponse) {
        // Pop resolved question
        const idx = this.unresolvedQuestions.indexOf(intentMeta.detectedQuestion);
        if (idx !== -1) {
          this.unresolvedQuestions.splice(idx, 1);
        }
      }
    }

    logDiag('ContextManager:TurnAdded', 'Turn recorded into short-term memory', {
      turnId: turn.id,
      speaker,
      intent: turn.intent,
      activeTopic: this.activeTopic,
      primaryLanguage: this.primaryLanguage,
    });
  }

  getActiveTopic(): string | undefined {
    return this.activeTopic ?? undefined;
  }

  getPrimaryLanguage(): string | undefined {
    return this.primaryLanguage ?? undefined;
  }

  getRecentQuestions(): string[] {
    return this.turns
      .filter((t) => Boolean(t.detectedQuestion))
      .map((t) => t.detectedQuestion!)
      .slice(-5);
  }

  getSnapshot(): ContextSnapshot {
    return {
      activeTopic: this.activeTopic ?? undefined,
      primaryLanguage: this.primaryLanguage ?? undefined,
      recentTurns: [...this.turns],
      recentQuestions: this.getRecentQuestions(),
      importantEntities: Object.fromEntries(this.importantEntities),
      unresolvedQuestions: [...this.unresolvedQuestions],
      hasScreenContext: false,
    };
  }

  /**
   * Builds an intentional, bounded context window for Gemini prompt construction.
   * If the current question is a follow-up, attaches the immediately preceding Q&A turn.
   * If a topic change is detected, excludes older irrelevant context to prevent bleed-through.
   */
  getContextForPrompt(intentMeta: IntentMetadata): string {
    if (this.turns.length === 0) return '';

    // If it's a follow-up, prioritize the last 2-3 turns strongly
    if (intentMeta.isFollowUp || intentMeta.requiresPreviousContext) {
      const recent = this.turns.slice(-3);
      return recent
        .map((t) => {
          let str = `${t.speaker === 'system' ? 'Interviewer/Meeting' : 'You'}: ${t.text}`;
          if (t.aiResponse) {
            str += `\n[Previous Copilot Answer]: ${t.aiResponse.slice(0, 350)}`;
          }
          return str;
        })
        .join('\n\n');
    }

    // If the question is standalone and establishes a completely different topic,
    // do NOT force older context into the prompt
    if (intentMeta.relevantEntities.length > 0 && this.activeTopic) {
      const isOverlapping = intentMeta.relevantEntities.some((e) =>
        this.activeTopic?.toLowerCase().includes(e.toLowerCase()),
      );
      if (!isOverlapping && !intentMeta.requiresPreviousContext) {
        // Topic changed cleanly (e.g. from Java polymorphism to SQL or React)
        return '';
      }
    }

    // Default: Return the most recent 3 turns cleanly formatted
    const relevant = this.turns.slice(-3);
    return relevant
      .map((t) => `${t.speaker === 'system' ? 'Interviewer/Meeting' : 'You'}: ${t.text}`)
      .join('\n');
  }
}
