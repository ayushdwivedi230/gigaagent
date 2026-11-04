import type { Result, SessionMode, SuggestionItem } from '@shared/types';
import { IntentClassifier } from './intentClassifier';
import { QuestionDetector } from './questionDetector';
import { ConversationContextManager } from './conversationContextManager';
import { ConversationStateManager } from './conversationStateManager';
import { DuplicateResponseGuard } from './duplicateResponseGuard';
import { ModeConfigurationService } from './modeConfigurationService';
import { PromptBuilder } from './promptBuilder';
import { ResponseQualityController } from './responseQualityController';
import type { OrchestrationRequest } from './types';
import { logDiag } from '../diagnosticsLogger';

export interface ResponseOrchestratorOptions {
  onEmitSuggestion: (item: SuggestionItem) => void;
  geminiRequester: (prompt: string, screenBase64?: string) => Promise<{ text: string; modelUsed: string }>;
}

export class ResponseOrchestrator {
  readonly classifier = new IntentClassifier();
  readonly detector = new QuestionDetector();
  readonly contextManager = new ConversationContextManager();
  readonly stateManager = new ConversationStateManager();
  readonly duplicateGuard = new DuplicateResponseGuard();
  readonly modeService = new ModeConfigurationService();
  readonly promptBuilder = new PromptBuilder();
  readonly qualityController = new ResponseQualityController();

  private readonly onEmitSuggestion: (item: SuggestionItem) => void;
  private readonly geminiRequester: (prompt: string, screenBase64?: string) => Promise<{ text: string; modelUsed: string }>;
  private suggestionCounter = 0;

  constructor(options: ResponseOrchestratorOptions) {
    this.onEmitSuggestion = options.onEmitSuggestion;
    this.geminiRequester = options.geminiRequester;
  }

  setSession(sessionId: string | null, mode: SessionMode = 'mock-interview'): void {
    this.stateManager.setSession(sessionId, mode);
    this.contextManager.reset();
    this.duplicateGuard.clear();
  }

  setMode(mode: SessionMode): void {
    this.stateManager.setMode(mode);
  }

  /**
   * Main asynchronous pipeline entrypoint.
   * Processes speech transcript segments or explicit manual Ask AI queries.
   */
  async processUtterance(request: OrchestrationRequest): Promise<Result<SuggestionItem | null>> {
    const text = request.text.trim();
    if (!text) {
      return { ok: true, value: null };
    }

    const mode = request.mode ?? this.stateManager.getMode();
    const profile = this.modeService.getProfile(mode);
    const speaker = request.speaker ?? 'user';

    // Step 1: Detect question/acknowledgement/greeting
    const detection = this.detector.detect(text);

    // If it's an acknowledgement (e.g. "Okay, got it"), record in context but do NOT respond
    if (detection.isAcknowledgement) {
      logDiag('Orchestrator:Acknowledgement', 'Acknowledgement detected, skipping AI generation', { text });
      this.contextManager.addTurn(speaker, text);
      return { ok: true, value: null };
    }

    // If standalone greeting without question, skip response
    if (detection.isGreeting && !request.isManual) {
      logDiag('Orchestrator:Greeting', 'Greeting detected, skipping AI response', { text });
      this.contextManager.addTurn(speaker, text);
      return { ok: true, value: null };
    }

    // Step 2: Check duplicate guard
    if (this.duplicateGuard.isDuplicate(text)) {
      logDiag('Orchestrator:Duplicate', 'Duplicate query dropped by guard', { text });
      return { ok: true, value: null };
    }

    // Step 3: Classify intent with context awareness
    const activeTopic = this.contextManager.getActiveTopic();
    const activeLang = this.contextManager.getPrimaryLanguage();
    const intentMeta = this.classifier.classify(text, activeTopic, activeLang);

    // If passive statement not needing an answer and not manual, skip AI generation
    if (!request.isManual && !intentMeta.needsAnswer) {
      logDiag('Orchestrator:Passive', 'Utterance does not require AI answer', { text, intent: intentMeta.intent });
      this.contextManager.addTurn(speaker, text, intentMeta);
      return { ok: true, value: null };
    }

    // Step 4: Check mode profile auto-answer rules (e.g. meeting interruptions)
    if (!request.isManual && !profile.shouldAutoAnswerSpeech(intentMeta, speaker)) {
      logDiag('Orchestrator:ModeSuppressed', 'Response suppressed by mode profile', { mode, intent: intentMeta.intent });
      this.contextManager.addTurn(speaker, text, intentMeta);
      return { ok: true, value: null };
    }

    // Step 5: Start request tracking
    const reqId = this.stateManager.startRequest();
    this.duplicateGuard.markInFlight(text);

    try {
      // Step 6: Context retrieval
      const priorContext = request.context || this.contextManager.getContextForPrompt(intentMeta);
      const hasScreen = Boolean(request.screenshotBase64);

      // Step 7: Construct tailored prompt
      const prompt = this.promptBuilder.buildPrompt({
        intentMeta,
        profile,
        priorContext,
        hasScreenContext: hasScreen,
      });

      logDiag('Orchestrator:PromptBuilt', 'Constructed tailored prompt', {
        intent: intentMeta.intent,
        mode,
        hasPriorContext: Boolean(priorContext),
        hasScreen,
        reqId,
      });

      // Step 8: Call Gemini with timeout and model fallback
      let { text: rawResponse, modelUsed } = await this.geminiRequester(prompt, request.screenshotBase64);

      // Parse JSON response
      let parsed = this.parseJson(rawResponse);
      let content = parsed.content || rawResponse;

      // Step 9: Response Quality Controller validation
      const quality = this.qualityController.validate(content, intentMeta);
      if (!quality.valid && quality.retryInstruction) {
        logDiag('Orchestrator:QualityRetry', 'Retrying response due to quality failure', {
          reason: quality.reason,
          retryInstruction: quality.retryInstruction,
        });

        const retryPrompt = `${prompt}\n\nIMPORTANT CORRECTION FROM QUALITY CONTROLLER:\n${quality.retryInstruction}`;
        const retryResult = await this.geminiRequester(retryPrompt, request.screenshotBase64);
        rawResponse = retryResult.text;
        modelUsed = retryResult.modelUsed;
        parsed = this.parseJson(rawResponse);
        content = parsed.content || rawResponse;
      }

      // Step 10: Check if superseded by a newer question
      if (!this.stateManager.completeRequest(reqId, text)) {
        logDiag('Orchestrator:Stale', 'Discarding stale response superseded by newer question', {
          reqId,
          text,
        });
        return { ok: true, value: null };
      }

      // Step 11: Record completed turn
      this.duplicateGuard.recordCompleted(text);
      this.contextManager.addTurn(speaker, text, intentMeta, content);

      // Step 12: Build structured SuggestionItem
      const followUps = this.generateFollowUpSuggestions(intentMeta.intent, intentMeta.programmingLanguage);

      const suggestionItem: SuggestionItem = {
        id: `ai_${Date.now()}_${++this.suggestionCounter}`,
        sessionId: request.sessionId || this.stateManager.getSessionId() || 'live_copilot',
        createdAt: new Date().toISOString(),
        type: 'answer_tip',
        title: parsed.title || this.titleForIntent(intentMeta.intent),
        content,
        source: 'gemini',
        isQuestion: true,
        question: text,
        formatType: (parsed.formatType as any) || (intentMeta.expectedResponseFormat as any) || 'technical',
        modelUsed,
        hasVisualContext: hasScreen,
        intent: intentMeta.intent,
        programmingLanguage: intentMeta.programmingLanguage,
        followUpSuggestions: followUps,
      };

      this.onEmitSuggestion(suggestionItem);
      return { ok: true, value: suggestionItem };
    } catch (err) {
      this.duplicateGuard.releaseInFlight(text);
      this.stateManager.completeRequest(reqId);
      const errMsg = err instanceof Error ? err.message : String(err);
      logDiag('Orchestrator:Error', 'Error processing conversation intelligence pipeline', { error: errMsg });
      return {
        ok: false,
        error: {
          code: 'SOURCE_FAILED',
          message: `Conversation Intelligence error: ${errMsg}`,
        },
      };
    }
  }

  private parseJson(raw: string): { title?: string; formatType?: string; content?: string } {
    try {
      const cleaned = raw
        .replace(/^```json\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      let parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        parsed = parsed[0];
      }
      return parsed;
    } catch {
      const match = raw.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      if (match) {
        try {
          let parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            parsed = parsed[0];
          }
          return parsed;
        } catch {}
      }
      return { content: raw };
    }
  }

  private titleForIntent(intent: string): string {
    switch (intent) {
      case 'CODE_GENERATION':
        return 'Code Implementation';
      case 'DSA_PROBLEM':
        return 'DSA Solution';
      case 'CODE_DEBUGGING':
        return 'Code Fix & Analysis';
      case 'CODE_OPTIMIZATION':
        return 'Optimization Strategy';
      case 'SQL_QUERY':
        return 'SQL Query Solution';
      case 'BEHAVIORAL_INTERVIEW':
      case 'STAR_RESPONSE':
        return 'STAR Interview Answer';
      case 'SELF_INTRODUCTION':
        return 'Introduction Outline';
      case 'MEETING_SUMMARY':
        return 'Meeting Summary';
      case 'ACTION_ITEMS':
        return 'Action Items & Next Steps';
      case 'DECISION_EXTRACTION':
        return 'Key Decisions';
      default:
        return 'Technical Explanation';
    }
  }

  private generateFollowUpSuggestions(intent: string, lang?: string): string[] {
    switch (intent) {
      case 'CODE_GENERATION':
      case 'DSA_PROBLEM':
        return [
          'Can you optimize it?',
          'Explain the time and space complexity',
          'What are the critical edge cases?',
        ];
      case 'CODE_DEBUGGING':
        return [
          'How can I prevent this bug in the future?',
          'Can you show a unit test for this fix?',
        ];
      case 'TECHNICAL_CONCEPT':
      case 'DATABASE_CONCEPT':
      case 'COMPARISON':
        return [
          'Give me a concrete real-world example',
          'What are the key trade-offs?',
          `How would this be implemented in ${lang || 'production'}?`,
        ];
      case 'BEHAVIORAL_INTERVIEW':
      case 'STAR_RESPONSE':
      case 'PROJECT_EXPLANATION':
        return [
          'What was the most challenging technical blocker?',
          'What measurable metrics or results did you achieve?',
        ];
      case 'MEETING_SUMMARY':
      case 'ACTION_ITEMS':
        return [
          'Who is assigned to these action items?',
          'What are the unresolved blockers or deadlines?',
        ];
      default:
        return [
          'Can you give me an example?',
          'Can you explain this in simpler terms?',
        ];
    }
  }
}
