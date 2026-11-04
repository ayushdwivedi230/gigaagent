import type { ExpectedResponseFormat, IntentMetadata, IntentType } from './types';
import { QuestionDetector } from './questionDetector';

export class IntentClassifier {
  private readonly questionDetector = new QuestionDetector();

  classify(rawText: string, activeTopic?: string, activeLanguage?: string): IntentMetadata {
    const text = rawText.trim();
    const detection = this.questionDetector.detect(text);

    // 1. Acknowledgements
    if (detection.isAcknowledgement) {
      return {
        intent: 'ACKNOWLEDGEMENT',
        confidence: 0.98,
        detectedQuestion: text,
        relevantEntities: [],
        expectedResponseFormat: 'conversational',
        needsAnswer: false,
        requiresPreviousContext: false,
      };
    }

    // 2. Greetings
    if (detection.isGreeting) {
      return {
        intent: 'CONVERSATIONAL',
        confidence: 0.95,
        detectedQuestion: text,
        relevantEntities: [],
        expectedResponseFormat: 'conversational',
        needsAnswer: false,
        requiresPreviousContext: false,
      };
    }

    const lower = text.toLowerCase();
    const detectedLanguage = this.extractLanguage(lower) || activeLanguage;
    const onlyCodeRequested =
      /\b(only code|just code|code only|without explanation|no explanation)\b/i.test(lower);
    const entities = this.extractEntities(text, detectedLanguage);

    // 3. Code Debugging
    if (
      /\b(find the bug|debug|fix the bug|error in this|issue with this|why is this failing|nullpointerexception|syntaxerror|runtime error|infinite loop|incorrect loop)\b/i.test(
        lower,
      )
    ) {
      return {
        intent: 'CODE_DEBUGGING',
        confidence: 0.92,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'code',
        needsAnswer: true,
        requiresPreviousContext: /\b(this|it|the code|the function)\b/i.test(lower),
        programmingLanguage: detectedLanguage,
        onlyCodeRequested,
      };
    }

    // 4. Code Optimization
    if (
      /\b(optimize it|can you optimize|make this faster|improve complexity|reduce time complexity|reduce space|more efficient)\b/i.test(
        lower,
      )
    ) {
      return {
        intent: 'CODE_OPTIMIZATION',
        confidence: 0.93,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'code',
        needsAnswer: true,
        requiresPreviousContext: true,
        programmingLanguage: detectedLanguage,
        isFollowUp: true,
        onlyCodeRequested,
      };
    }

    // 5. DSA Problem Solving
    if (
      /\b(two sum|second-largest|second largest|binary search|reverse an array|reverse array|linked list|palindrome|valid parentheses|merge sorted|subarray|longest substring|dynamic programming|sliding window|tree traversal|graph|quicksort|mergesort)\b/i.test(
        lower,
      ) ||
      (/\b(solve|implement|algorithm)\b/i.test(lower) &&
        /\b(array|string|list|tree|graph|matrix|dp|stack|queue|hashmap)\b/i.test(lower))
    ) {
      return {
        intent: 'DSA_PROBLEM',
        confidence: 0.94,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'dsa',
        needsAnswer: true,
        requiresPreviousContext: false,
        programmingLanguage: detectedLanguage,
        onlyCodeRequested,
      };
    }

    // 6. SQL Query
    const isComparisonQuery = /\b(difference between|compare|trade-offs? between|vs\b|versus|pros and cons)\b/i.test(lower);
    if (
      !isComparisonQuery &&
      (/\b(sql query|write (a )?query|select\s+.*\s+from|join\b|group by|having\b|second-highest salary|second highest salary|database query)\b/i.test(
        lower,
      ) || (/\bsql\b/i.test(lower) && /\b(query|table|schema|database|select|insert|update|delete)\b/i.test(lower)))
    ) {
      return {
        intent: 'SQL_QUERY',
        confidence: 0.95,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'code',
        needsAnswer: true,
        requiresPreviousContext: false,
        programmingLanguage: 'sql',
        onlyCodeRequested,
      };
    }

    // 7. General Code Generation
    if (
      /\b(write (a )?(program|code|function|script|class|method)|generate code|implement)\b/i.test(
        lower,
      ) ||
      (/\bcode\b/i.test(lower) && /\b(in java|in python|in c\+\+|in javascript|in typescript|in sql)\b/i.test(lower))
    ) {
      return {
        intent: 'CODE_GENERATION',
        confidence: 0.93,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'code',
        needsAnswer: true,
        requiresPreviousContext: false,
        programmingLanguage: detectedLanguage,
        onlyCodeRequested,
      };
    }

    // 8. Self Introduction
    if (
      /\b(tell me about yourself|introduce yourself|walk me through your (resume|background|experience)|who are you)\b/i.test(
        lower,
      )
    ) {
      return {
        intent: 'SELF_INTRODUCTION',
        confidence: 0.96,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'interview_spoken',
        needsAnswer: true,
        requiresPreviousContext: false,
      };
    }

    // 9. Project Explanation
    if (
      /\b(tell me about your project|walk me through your project|describe a project|architecture of your project)\b/i.test(
        lower,
      )
    ) {
      return {
        intent: 'PROJECT_EXPLANATION',
        confidence: 0.93,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'interview_star',
        needsAnswer: true,
        requiresPreviousContext: false,
      };
    }

    // 10. Behavioral & STAR interview questions
    if (
      /\b(tell me about a time|describe a situation|how do you handle (conflict|pressure|deadlines|failure)|star format|star response|weakness|strength)\b/i.test(
        lower,
      )
    ) {
      return {
        intent: 'BEHAVIORAL_INTERVIEW',
        confidence: 0.94,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'interview_star',
        needsAnswer: true,
        requiresPreviousContext: false,
      };
    }

    // 11. Meeting Summary
    if (
      /\b(summarize (this |the )?meeting|meeting summary|recap (the )?meeting|what was discussed in (this |the )?meeting)\b/i.test(
        lower,
      )
    ) {
      return {
        intent: 'MEETING_SUMMARY',
        confidence: 0.95,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'meeting_summary',
        needsAnswer: true,
        requiresPreviousContext: true,
      };
    }

    // 12. Action Items
    if (
      /\b(action items|next steps|to-do list|tasks assigned|what are the next steps|who is doing what)\b/i.test(
        lower,
      )
    ) {
      return {
        intent: 'ACTION_ITEMS',
        confidence: 0.94,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'action_items',
        needsAnswer: true,
        requiresPreviousContext: true,
      };
    }

    // 13. Decision Extraction
    if (
      /\b(what did we decide|what was decided|decision on|did we agree on)\b/i.test(
        lower,
      )
    ) {
      return {
        intent: 'DECISION_EXTRACTION',
        confidence: 0.92,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'technical',
        needsAnswer: true,
        requiresPreviousContext: true,
      };
    }

    // 14. Meeting Follow-up Query
    if (
      /\b(what did (he|she|they) say about|what was said about|when is the deadline|who is the owner)\b/i.test(
        lower,
      )
    ) {
      return {
        intent: 'FOLLOW_UP_QUESTION',
        confidence: 0.91,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'technical',
        needsAnswer: true,
        requiresPreviousContext: true,
        isFollowUp: true,
      };
    }

    // 15. Comparison (Technical & General)
    if (
      /\b(difference between|compare|trade-offs? between|vs\b|versus|pros and cons of)\b/i.test(
        lower,
      )
    ) {
      const isSqlVsNosql = /\b(sql and nosql|sql vs nosql)\b/i.test(lower);
      return {
        intent: isSqlVsNosql ? 'DATABASE_CONCEPT' : 'COMPARISON',
        confidence: 0.92,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'technical',
        needsAnswer: true,
        requiresPreviousContext: false,
      };
    }

    // 16. Technical Concept / Explanation
    if (
      /\b(polymorphism|inheritance|encapsulation|abstraction|overriding|overloading|raft consensus|acid properties|sharding|indexing|event loop|microservices|rest api|graphql|docker|kubernetes|ci\/cd)\b/i.test(
        lower,
      ) ||
      (/\bexplain\b/i.test(lower) && /\b(how|what|concept|mechanism)\b/i.test(lower))
    ) {
      return {
        intent: 'TECHNICAL_CONCEPT',
        confidence: 0.90,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'technical',
        needsAnswer: true,
        requiresPreviousContext: false,
        programmingLanguage: detectedLanguage,
      };
    }

    // 17. Follow-up inquiry needing prior context
    if (
      detection.isFollowUp ||
      /\b(give me an example of that|give me an example|what happens next|show me an example|what about edge cases)\b/i.test(
        lower,
      )
    ) {
      return {
        intent: 'EXPLANATION',
        confidence: 0.88,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'technical',
        needsAnswer: true,
        requiresPreviousContext: true,
        isFollowUp: true,
        programmingLanguage: detectedLanguage,
      };
    }

    // 18. General Question
    if (detection.isExplicitQuestion) {
      return {
        intent: 'GENERAL_QUESTION',
        confidence: 0.82,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'explanation',
        needsAnswer: true,
        requiresPreviousContext: false,
      };
    }

    // 19. Statements / Discussion in meetings (e.g. "We should discuss deployment tomorrow")
    if (/\b(we should|let's|i think|maybe we can|moving on to)\b/i.test(lower)) {
      return {
        intent: 'DISCUSSION',
        confidence: 0.78,
        detectedQuestion: text,
        relevantEntities: entities,
        expectedResponseFormat: 'conversational',
        needsAnswer: false, // Don't interrupt passive discussion!
        requiresPreviousContext: true,
      };
    }

    // 20. Default / Fallback
    return {
      intent: 'UNKNOWN',
      confidence: 0.50,
      detectedQuestion: text,
      relevantEntities: entities,
      expectedResponseFormat: 'explanation',
      needsAnswer: detection.isQuestionOrInstruction,
      requiresPreviousContext: false,
    };
  }

  private extractLanguage(lowerText: string): string | undefined {
    if (/\b(java)\b/i.test(lowerText) && !/\b(javascript)\b/i.test(lowerText)) return 'java';
    if (/\b(python|py)\b/i.test(lowerText)) return 'python';
    if (/\b(cpp|c\+\+)(?!\w)/i.test(lowerText)) return 'cpp';
    if (/\b(c#|csharp)(?!\w)/i.test(lowerText)) return 'csharp';
    if (/\b(javascript|js|node\.js|nodejs)\b/i.test(lowerText)) return 'javascript';
    if (/\b(typescript|ts)\b/i.test(lowerText)) return 'typescript';
    if (/\b(sql|postgres|mysql|sqlite)\b/i.test(lowerText)) return 'sql';
    if (/\b(golang|go)\b/i.test(lowerText)) return 'go';
    if (/\b(rust)\b/i.test(lowerText)) return 'rust';
    return undefined;
  }

  private extractEntities(text: string, language?: string): string[] {
    const entities: string[] = [];
    if (language) entities.push(language);

    const patterns = [
      /\b(polymorphism|inheritance|encapsulation|abstraction|overriding|overloading)\b/gi,
      /\b(binary search|two sum|second-largest|quicksort|mergesort)\b/gi,
      /\b(sql|nosql|postgresql|mongodb|redis|kafka|docker|kubernetes|aws)\b/gi,
      /\b(star format|interview|resume|salary|deadline|deployment)\b/gi,
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const m of matches) {
          const norm = m.toLowerCase();
          if (!entities.includes(norm)) entities.push(norm);
        }
      }
    }
    return entities;
  }
}
