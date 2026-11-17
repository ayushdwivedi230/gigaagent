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
import { parseAnswer, streamingBody } from './answerParser';
import { formatTypeForIntent } from './promptBuilder';
import { logDiag } from '../diagnosticsLogger';

export interface RequesterOptions {
  signal?: AbortSignal | undefined;
  onDelta?: ((accumulated: string) => void) | undefined;
  json?: boolean | undefined;
  preferredModel?: string | undefined;
  maxOutputTokens?: number | undefined;
}

export type GeminiRequester = (
  prompt: string,
  screenBase64?: string,
  options?: RequesterOptions,
) => Promise<{ text: string; modelUsed: string }>;

export interface ResponseOrchestratorOptions {
  onEmitSuggestion: (item: SuggestionItem) => void;
  geminiRequester: GeminiRequester;
  /** Maps a thrown provider error to a user-facing message + whether it was a cancellation. */
  describeError?: (error: unknown) => { message: string; cancelled: boolean };
}

const MAX_TOKENS: Record<string, number> = { quick: 512, natural: 1536, structured: 2048, 'deep-dive': 4096 };

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
  private readonly geminiRequester: GeminiRequester;
  private readonly describeError: (error: unknown) => { message: string; cancelled: boolean };
  private readonly inFlight = new Map<string, AbortController>();
  private suggestionCounter = 0;

  constructor(options: ResponseOrchestratorOptions) {
    this.onEmitSuggestion = options.onEmitSuggestion;
    this.geminiRequester = options.geminiRequester;
    this.describeError =
      options.describeError ??
      ((error) => ({ message: `Conversation Intelligence error: ${error instanceof Error ? error.message : String(error)}`, cancelled: false }));
  }

  /** Cancels one in-flight answer, or all of them when no id is given. Returns how many were cancelled. */
  cancel(requestId?: string): number {
    const targets = requestId ? [requestId].filter((id) => this.inFlight.has(id)) : [...this.inFlight.keys()];
    for (const id of targets) {
      this.inFlight.get(id)?.abort();
      this.inFlight.delete(id);
    }
    return targets.length;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  setSession(sessionId: string | null, mode: SessionMode = 'mock-interview'): void {
    this.stateManager.setSession(sessionId, mode);
    this.contextManager.reset();
    this.duplicateGuard.clear();
    this.cancel();
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

    // If it's an acknowledgement (e.g. "Okay, got it"), record in context but do NOT respond unless user manually asked
    if (detection.isAcknowledgement && !request.isManual) {
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

    // Step 2: Check duplicate guard (bypass for manual user actions so clicking Ask AI or re-asking always runs)
    if (!request.isManual && this.duplicateGuard.isDuplicate(text)) {
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
    const requestKey = request.requestId ?? `auto_${reqId}`;
    const controller = new AbortController();
    this.inFlight.set(requestKey, controller);
    const isRevision = Boolean(request.action && request.action !== 'regenerate' && request.previousAnswer);

    try {
      // Step 6: Context retrieval
      const priorContext = request.context || this.contextManager.getContextForPrompt(intentMeta);
      const hasScreen = Boolean(request.screenshotBase64);
      const streaming = Boolean(request.onDelta);

      // Step 7: Construct tailored prompt
      const prompt = this.promptBuilder.buildPrompt({
        intentMeta,
        profile,
        priorContext,
        hasScreenContext: hasScreen,
        answerFormat: request.answerFormat,
        speakingTargetSec: request.speakingTargetSec,
        action: request.action,
        previousAnswer: request.previousAnswer,
        customInstructions: request.customInstructions,
        preparationProfile: request.preparationProfile,
        output: streaming ? 'markdown' : 'json',
      });

      logDiag('Orchestrator:PromptBuilt', 'Constructed tailored prompt', {
        intent: intentMeta.intent,
        mode,
        hasPriorContext: Boolean(priorContext),
        hasScreen,
        reqId,
        promptChars: prompt.length,
      });

      const requesterOptions: RequesterOptions = {
        signal: controller.signal,
        json: !streaming,
        preferredModel: request.preferredModel,
        maxOutputTokens: MAX_TOKENS[request.answerFormat ?? 'structured'] ?? 2048,
        onDelta: streaming ? (acc) => request.onDelta?.(streamingBody(acc)) : undefined,
      };

      // Step 8: Call Gemini with timeout and model fallback
      let { text: rawResponse, modelUsed } = await this.geminiRequester(prompt, request.screenshotBase64, requesterOptions);

      let parsed = parseAnswer(rawResponse);
      let content = parsed.content || rawResponse;

      // Step 9: Response Quality Controller validation (skipped for revisions of an existing answer)
      const quality = isRevision ? { valid: true as const } : this.qualityController.validate(content, intentMeta);
      if (!quality.valid && quality.retryInstruction) {
        logDiag('Orchestrator:QualityRetry', 'Retrying response due to quality failure', {
          reason: quality.reason,
          retryInstruction: quality.retryInstruction,
        });

        const retryPrompt = `${prompt}\n\nIMPORTANT CORRECTION FROM QUALITY CONTROLLER:\n${quality.retryInstruction}`;
        const retryResult = await this.geminiRequester(retryPrompt, request.screenshotBase64, requesterOptions);
        rawResponse = retryResult.text;
        modelUsed = retryResult.modelUsed;
        parsed = parseAnswer(rawResponse);
        content = parsed.content || rawResponse;
      }

      // Step 10: Check if superseded by a newer question
      if (!this.stateManager.completeRequest(reqId, text)) {
        logDiag('Orchestrator:Stale', 'Discarding stale response superseded by newer question', { reqId });
        this.duplicateGuard.releaseInFlight(text);
        return request.isManual
          ? { ok: false, error: { code: 'CANCELLED', message: 'This answer was replaced by a newer question.' } }
          : { ok: true, value: null };
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
        formatType: ((parsed.formatType as SuggestionItem['formatType']) || formatTypeForIntent(intentMeta.intent)) ?? 'technical',
        modelUsed,
        hasVisualContext: hasScreen,
        intent: intentMeta.intent,
        followUpSuggestions: followUps,
      };
      if (intentMeta.programmingLanguage) suggestionItem.programmingLanguage = intentMeta.programmingLanguage;
      if (request.answerFormat) suggestionItem.answerFormat = request.answerFormat;
      if (request.speakingTargetSec) suggestionItem.speakingTargetSec = request.speakingTargetSec;
      if (request.action) suggestionItem.action = request.action;
      if (request.requestId) suggestionItem.requestId = request.requestId;

      this.onEmitSuggestion(suggestionItem);
      return { ok: true, value: suggestionItem };
    } catch (err) {
      this.duplicateGuard.releaseInFlight(text);
      this.stateManager.completeRequest(reqId);
      const described = this.describeError(err);
      const cancelled = described.cancelled || controller.signal.aborted;
      logDiag('Orchestrator:Error', cancelled ? 'Answer generation cancelled' : 'Error processing conversation intelligence pipeline', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        error: cancelled
          ? { code: 'CANCELLED', message: 'The answer was cancelled.' }
          : { code: 'SOURCE_FAILED', message: described.message },
      };
    } finally {
      this.inFlight.delete(requestKey);
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
