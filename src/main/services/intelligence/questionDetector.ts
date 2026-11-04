import type { QuestionDetectionResult } from './types';

export class QuestionDetector {
  private static readonly ACKNOWLEDGEMENT_PATTERNS = [
    /^(ok|okay|got it|understood|makes sense|that makes sense|cool|right|sure|all right|alright|i see|thank you|thanks|no problem|sounds good|noted|perfect|great|fine|yep|yeah|yes|no|nope)\.?$/i,
    /^(ok|okay)[,\s]+(that\s+)?(makes sense|got it|thank you|thanks|sounds good|noted|perfect|great)\.?$/i,
    /^(thank you|thanks)\s+(very much|so much|a lot)?\.?$/i,
    /^(that makes sense|makes sense to me)\.?$/i,
  ];

  private static readonly GREETING_PATTERNS = [
    /^(hello|hi|hey|good morning|good afternoon|good evening|greetings)\b/i,
  ];

  private static readonly FOLLOW_UP_PATTERNS = [
    /\b(so what happens next|what happens next|what about|how about|can you optimize|optimize (it|this|that)|give me an example( of that)?|now explain|show me an example|what if|why is that|can you elaborate|what does that mean|any edge cases|what is the time complexity|what is the space complexity|how would you scale (this|it)|now do it in|can we do better)\b/i,
    /\b(give me an example|explain (that|this|the above)|walk me through (that|this)|what about the edge cases|can you make it faster)\b/i,
  ];

  private static readonly IMPERATIVE_INSTRUCTION_START = [
    /^(please\s+|kindly\s+|now\s+)?(write|create|implement|code|build|develop|generate|solve|find|reverse|sort|debug|fix|optimize|refactor|design|explain|summarize|list|compare|describe|walk me through|tell me about|show me|give me)\b/i,
  ];

  private static readonly INSTRUCTION_PATTERNS = [
    /\b(please|can you|could you|help me)\s+(write|create|implement|code|generate|solve|find|reverse|sort|debug|fix|optimize|refactor|design|explain|summarize|list|compare|describe|walk me through|tell me about|show me|give me)\b/i,
    /\b(write\s+(a\s+|an\s+|the\s+)?(program|code|function|class|method|script|query|algorithm)|solve\s+(the\s+)?(two sum|problem|puzzle)|find\s+the\s+(bug|error|second|duplicate|maximum|minimum)|reverse\s+(an?\s+|the\s+)?(array|string|linked list)|implement\s+(a\s+|an\s+|the\s+)?(binary search|stack|queue|hash map|lru cache|linked list|tree))\b/i,
  ];

  private static readonly QUESTION_WORDS = [
    /\b(what|why|how|when|where|who|which|whose|whom)\b/i,
    /\b(can you|could you|would you|should we|do you|did you|is it|are there|does it|have you|will this)\b/i,
  ];

  private static readonly PERSONAL_NARRATIVE_START = [
    /^(i |we |my |our |i've |i'd |i'm |we're |we've |in my |at my |during my )\b/i,
  ];

  detect(rawText: string): QuestionDetectionResult {
    const cleanText = rawText.trim();
    if (!cleanText) {
      return {
        isQuestionOrInstruction: false,
        isExplicitQuestion: false,
        isInstruction: false,
        isFollowUp: false,
        isAcknowledgement: false,
        isGreeting: false,
        cleanText: '',
      };
    }

    // 1. Check Acknowledgements
    const isAcknowledgement = QuestionDetector.ACKNOWLEDGEMENT_PATTERNS.some((p) =>
      p.test(cleanText),
    );
    if (isAcknowledgement) {
      return {
        isQuestionOrInstruction: false,
        isExplicitQuestion: false,
        isInstruction: false,
        isFollowUp: false,
        isAcknowledgement: true,
        isGreeting: false,
        cleanText,
      };
    }

    // 2. Check standalone greetings (short greeting without a question)
    const isGreeting =
      QuestionDetector.GREETING_PATTERNS.some((p) => p.test(cleanText)) &&
      cleanText.split(/\s+/).length <= 4 &&
      !cleanText.includes('?');
    if (isGreeting) {
      return {
        isQuestionOrInstruction: false,
        isExplicitQuestion: false,
        isInstruction: false,
        isFollowUp: false,
        isAcknowledgement: false,
        isGreeting: true,
        cleanText,
      };
    }

    // 3. Follow-up check
    const isFollowUp = QuestionDetector.FOLLOW_UP_PATTERNS.some((p) => p.test(cleanText));

    // 4. Explicit question check
    const hasQuestionMark = cleanText.endsWith('?');
    const hasQuestionWords = QuestionDetector.QUESTION_WORDS.some((p) => p.test(cleanText));
    const isExplicitQuestion = hasQuestionMark || hasQuestionWords;

    // 5. Instruction check (e.g. "Write a Java program to reverse an array", "Explain polymorphism")
    const isPersonalNarrative =
      QuestionDetector.PERSONAL_NARRATIVE_START.some((p) => p.test(cleanText)) &&
      !/^(i (want|need|would like) you to)\b/i.test(cleanText);

    let isInstruction = false;
    if (!isPersonalNarrative) {
      const startsWithImperative = QuestionDetector.IMPERATIVE_INSTRUCTION_START.some((p) =>
        p.test(cleanText),
      );
      const matchesInstructionPattern = QuestionDetector.INSTRUCTION_PATTERNS.some((p) =>
        p.test(cleanText),
      );
      isInstruction = startsWithImperative || matchesInstructionPattern;
    }

    const isQuestionOrInstruction =
      isExplicitQuestion || isInstruction || isFollowUp;

    return {
      isQuestionOrInstruction,
      isExplicitQuestion,
      isInstruction,
      isFollowUp,
      isAcknowledgement: false,
      isGreeting: false,
      cleanText,
    };
  }
}
