import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IntentClassifier,
  QuestionDetector,
  ConversationContextManager,
  ConversationStateManager,
  DuplicateResponseGuard,
  ModeConfigurationService,
  PromptBuilder,
  ResponseQualityController,
  ResponseOrchestrator,
} from '../src/main/services/intelligence';
import type { SuggestionItem } from '../src/shared/types';

// ==========================================
// SCENARIO 1 - 8: Intent Classification & Follow-up
// ==========================================

test('1. Intent Classification: "Explain polymorphism" identifies technical concept', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Explain polymorphism');
  assert.equal(meta.intent, 'TECHNICAL_CONCEPT');
  assert.equal(meta.needsAnswer, true);
  assert.equal(meta.expectedResponseFormat, 'technical');
});

test('2. Intent Classification: "Write Java code for binary search" identifies DSA problem with Java', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Write Java code for binary search');
  assert.equal(meta.intent, 'DSA_PROBLEM');
  assert.equal(meta.programmingLanguage, 'java');
  assert.equal(meta.expectedResponseFormat, 'dsa');
  assert.equal(meta.needsAnswer, true);
});

test('3. Intent Classification: "Find the bug in this function" identifies code debugging', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Find the bug in this function');
  assert.equal(meta.intent, 'CODE_DEBUGGING');
  assert.equal(meta.expectedResponseFormat, 'code');
  assert.equal(meta.needsAnswer, true);
});

test('4. Intent Classification: "What is the difference between SQL and NoSQL?" identifies database concept comparison', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('What is the difference between SQL and NoSQL?');
  assert.equal(meta.intent, 'DATABASE_CONCEPT');
  assert.equal(meta.expectedResponseFormat, 'technical');
  assert.equal(meta.needsAnswer, true);
});

test('5. Intent Classification: "Tell me about yourself" identifies self introduction', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Tell me about yourself');
  assert.equal(meta.intent, 'SELF_INTRODUCTION');
  assert.equal(meta.expectedResponseFormat, 'interview_spoken');
  assert.equal(meta.needsAnswer, true);
});

test('6. Intent Classification: "Summarize this meeting" identifies meeting summary needing prior context', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Summarize this meeting');
  assert.equal(meta.intent, 'MEETING_SUMMARY');
  assert.equal(meta.expectedResponseFormat, 'meeting_summary');
  assert.equal(meta.requiresPreviousContext, true);
  assert.equal(meta.needsAnswer, true);
});

test('7. Intent Classification: "What did he say about deployment?" identifies meeting follow-up question', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('What did he say about deployment?');
  assert.equal(meta.intent, 'FOLLOW_UP_QUESTION');
  assert.equal(meta.isFollowUp, true);
  assert.equal(meta.requiresPreviousContext, true);
  assert.equal(meta.needsAnswer, true);
});

test('8. Intent Classification: "Give me an example of that" detects follow-up needing prior context', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Give me an example of that');
  assert.equal(meta.isFollowUp, true);
  assert.equal(meta.requiresPreviousContext, true);
  assert.equal(meta.needsAnswer, true);
});

// ==========================================
// SCENARIO 9 - 12: Acknowledgement Suppression
// ==========================================

test('9. Acknowledgement: "Okay, that makes sense" does not require an AI answer', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Okay, that makes sense');
  assert.equal(meta.intent, 'ACKNOWLEDGEMENT');
  assert.equal(meta.needsAnswer, false);
});

test('10. Acknowledgement: "Got it" does not require an AI answer', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Got it');
  assert.equal(meta.intent, 'ACKNOWLEDGEMENT');
  assert.equal(meta.needsAnswer, false);
});

test('11. Acknowledgement: "Sounds good" does not require an AI answer', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Sounds good');
  assert.equal(meta.intent, 'ACKNOWLEDGEMENT');
  assert.equal(meta.needsAnswer, false);
});

test('12. Acknowledgement: "Thanks" does not require an AI answer', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Thanks');
  assert.equal(meta.intent, 'ACKNOWLEDGEMENT');
  assert.equal(meta.needsAnswer, false);
});

// ==========================================
// SCENARIO 13 - 18: Prompt Construction
// ==========================================

test('13. Prompt Construction: "Reverse an array in Java" instructs Java code with complexity analysis', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Reverse an array in Java');
  const builder = new PromptBuilder();
  const modeService = new ModeConfigurationService();
  const prompt = builder.buildPrompt({
    intentMeta: meta,
    profile: modeService.getProfile('mock-interview'),
  });

  assert.match(prompt, /Java/i);
  assert.match(prompt, /Runnable Implementation/i);
  assert.match(prompt, /Time Complexity/i);
  assert.match(prompt, /Space Complexity/i);
});

test('14. Prompt Construction: "Two Sum" structure includes problem understanding, approach, and code', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Two Sum in Python');
  const builder = new PromptBuilder();
  const modeService = new ModeConfigurationService();
  const prompt = builder.buildPrompt({
    intentMeta: meta,
    profile: modeService.getProfile('mock-interview'),
  });

  assert.match(prompt, /DSA Problem Solving/i);
  assert.match(prompt, /Python/i);
  assert.match(prompt, /Optimal Algorithmic Approach/i);
  assert.match(prompt, /formatType": "code"/i);
});

test('15. Prompt Construction: "Second-largest element" includes edge cases and complexity', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Find the second largest element in an array');
  const builder = new PromptBuilder();
  const modeService = new ModeConfigurationService();
  const prompt = builder.buildPrompt({
    intentMeta: meta,
    profile: modeService.getProfile('mock-interview'),
  });

  assert.match(prompt, /DSA Problem Solving/i);
  assert.match(prompt, /edge cases/i);
  assert.match(prompt, /Time Complexity/i);
});

test('16. Prompt Construction: "Binary search" includes dry run and constraints', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Implement binary search in C++');
  const builder = new PromptBuilder();
  const modeService = new ModeConfigurationService();
  const prompt = builder.buildPrompt({
    intentMeta: meta,
    profile: modeService.getProfile('mock-interview'),
  });

  assert.match(prompt, /cpp/i);
  assert.match(prompt, /Dry Run with Sample Input\/Output/i);
});

test('17. Prompt Construction: "SQL second-highest salary" instructs production SQL query', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Write a query for second highest salary');
  const builder = new PromptBuilder();
  const modeService = new ModeConfigurationService();
  const prompt = builder.buildPrompt({
    intentMeta: meta,
    profile: modeService.getProfile('mock-interview'),
  });

  assert.match(prompt, /SQL/i);
  assert.match(prompt, /Code Generation in sql/i);
});

test('18. Prompt Construction: "Debug incorrect Java loop" instructs root cause and corrected code', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Find the bug in this incorrect Java loop');
  const builder = new PromptBuilder();
  const modeService = new ModeConfigurationService();
  const prompt = builder.buildPrompt({
    intentMeta: meta,
    profile: modeService.getProfile('mock-interview'),
  });

  assert.match(prompt, /Code Debugging/i);
  assert.match(prompt, /Identified Issue \/ Bottleneck/i);
  assert.match(prompt, /Corrected \/ Optimized Code/i);
});

// ==========================================
// SCENARIO 19 - 22: Context Management & Screen Intelligence
// ==========================================

test('19. Context Memory: Multi-turn follow-up preserves active language and topic', () => {
  const contextManager = new ConversationContextManager();
  const classifier = new IntentClassifier();

  // Turn 1
  const meta1 = classifier.classify('What is polymorphism in Java?');
  contextManager.addTurn('system', 'What is polymorphism in Java?', meta1, 'Polymorphism allows objects to take many forms.');

  assert.equal(contextManager.getActiveTopic(), 'java, polymorphism');
  assert.equal(contextManager.getPrimaryLanguage(), 'java');

  // Turn 2
  const meta2 = classifier.classify('Give me an example of that', contextManager.getActiveTopic(), contextManager.getPrimaryLanguage());
  assert.equal(meta2.isFollowUp, true);
  assert.equal(meta2.programmingLanguage, 'java');

  const promptContext = contextManager.getContextForPrompt(meta2);
  assert.match(promptContext, /polymorphism/i);
  assert.match(promptContext, /Polymorphism allows objects to take many forms/i);
});

test('20. Context Memory: Switching to new topic clears older context bleed-through', () => {
  const contextManager = new ConversationContextManager();
  const classifier = new IntentClassifier();

  const meta1 = classifier.classify('What is polymorphism in Java?');
  contextManager.addTurn('system', 'What is polymorphism in Java?', meta1, 'Polymorphism explanation in Java');

  // Turn 2: Distinct new topic
  const meta2 = classifier.classify('Explain Docker containerization architecture');
  const promptContext = contextManager.getContextForPrompt(meta2);

  // Irrelevant Java context should NOT bleed through
  assert.equal(promptContext, '');
});

test('21. Screen Intelligence: Prompt builder incorporates visual context note when screenshot is present', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('What is this error on screen?');
  const builder = new PromptBuilder();
  const modeService = new ModeConfigurationService();
  const prompt = builder.buildPrompt({
    intentMeta: meta,
    profile: modeService.getProfile('mock-interview'),
    hasScreenContext: true,
  });

  assert.match(prompt, /\[Screen Intelligence\]: An active, confirmed screenshot of the user's screen is attached/i);
});

test('22. Screen Intelligence: Prompt builder omits visual context note when screenshot is absent', () => {
  const classifier = new IntentClassifier();
  const meta = classifier.classify('What is database indexing?');
  const builder = new PromptBuilder();
  const modeService = new ModeConfigurationService();
  const prompt = builder.buildPrompt({
    intentMeta: meta,
    profile: modeService.getProfile('mock-interview'),
    hasScreenContext: false,
  });

  assert.doesNotMatch(prompt, /\[Screen Intelligence\]/i);
});

// ==========================================
// SCENARIO 23 - 26: Duplicate Guard & Interruption Handling
// ==========================================

test('23. Orchestrator suppresses generation for acknowledgements', async () => {
  let callCount = 0;
  const orchestrator = new ResponseOrchestrator({
    onEmitSuggestion: () => {},
    geminiRequester: async () => {
      callCount++;
      return { text: '{}', modelUsed: 'gemini-1.5-flash' };
    },
  });

  const res = await orchestrator.processUtterance({ text: 'Okay, understood.' });
  assert.equal(res.ok, true);
  assert.equal(res.value, null);
  assert.equal(callCount, 0);
});

test('24. Duplicate Prevention: Guard blocks identical queries within cooldown', () => {
  const guard = new DuplicateResponseGuard(5000);
  const text = 'What is the time complexity of quicksort?';

  assert.equal(guard.isDuplicate(text), false);
  guard.recordCompleted(text);

  // Immediate retry within cooldown should be blocked
  assert.equal(guard.isDuplicate(text), true);
  assert.equal(guard.isDuplicate('what is the time complexity of quicksort'), true);
});

test('25. In-flight Deduplication: Guard blocks concurrent identical queries', () => {
  const guard = new DuplicateResponseGuard(5000);
  const text = 'Explain ACID properties in relational databases';

  assert.equal(guard.isDuplicate(text), false);
  guard.markInFlight(text);

  // In-flight query should be blocked
  assert.equal(guard.isDuplicate(text), true);

  // After release, not blocked
  guard.releaseInFlight(text);
  assert.equal(guard.isDuplicate(text), false);
});

test('26. Stale Request Rejection: State manager detects superseded requests', () => {
  const stateManager = new ConversationStateManager();
  stateManager.setSession('session_1', 'mock-interview');

  const req1 = stateManager.startRequest();
  assert.equal(req1, 1);

  const req2 = stateManager.startRequest();
  assert.equal(req2, 2);

  // Request 1 completes later -> should be rejected as stale
  const req1Valid = stateManager.completeRequest(req1, 'Old Question');
  assert.equal(req1Valid, false);

  // Request 2 completes -> valid
  const req2Valid = stateManager.completeRequest(req2, 'New Question');
  assert.equal(req2Valid, true);
  assert.equal(stateManager.getLastAnswered(), 'New Question');
});

// ==========================================
// SCENARIO 27 - 28: Response Quality Controller & Retry
// ==========================================

test('27. Quality Controller: Flags response missing code when code was requested', () => {
  const controller = new ResponseQualityController();
  const classifier = new IntentClassifier();
  const meta = classifier.classify('Write a Java program to reverse an array');

  // Response with zero code
  const badResponse = 'To reverse an array in Java, you can use two pointers and swap elements from both ends.';
  const result = controller.validate(badResponse, meta);

  assert.equal(result.valid, false);
  assert.equal(result.missingCode, true);
  assert.match(result.retryInstruction || '', /CRITICAL: You must provide the actual, complete, runnable code/i);

  // Response with code
  const goodResponse = 'Here is the solution:\n```java\nclass Solution {\n  public void reverse(int[] arr) {}\n}\n```';
  const goodResult = controller.validate(goodResponse, meta);
  assert.equal(goodResult.valid, true);
});

test('28. Orchestrator Quality Retry: Retries Gemini when code is omitted', async () => {
  let callCount = 0;
  const orchestrator = new ResponseOrchestrator({
    onEmitSuggestion: () => {},
    geminiRequester: async (prompt) => {
      callCount++;
      if (callCount === 1) {
        // First attempt: returns text without code
        return {
          text: JSON.stringify({
            title: 'Reverse Array',
            content: 'You can reverse an array by iterating backwards.',
          }),
          modelUsed: 'gemini-1.5-flash',
        };
      }
      // Second attempt (retry): returns code block
      return {
        text: JSON.stringify({
          title: 'Reverse Array in Java',
          content: '```java\npublic static void reverse(int[] a) {\n  // reversed\n}\n```',
        }),
        modelUsed: 'gemini-1.5-flash',
      };
    },
  });

  const res = await orchestrator.processUtterance({
    text: 'Write a Java method to reverse an array',
    isManual: true,
  });

  assert.equal(res.ok, true);
  assert.equal(callCount, 2); // 1 initial + 1 quality retry
  assert.match(res.value?.content || '', /```java/);
});

// ==========================================
// SCENARIO 29 - 30: Mode Configuration & End-to-End Orchestration
// ==========================================

test('29. Mode Configuration: Profiles enforce mode-specific behavioral directives', () => {
  const modeService = new ModeConfigurationService();

  const interviewProfile = modeService.getProfile('mock-interview');
  assert.match(interviewProfile.systemDirective, /live job interview/i);

  const meetingProfile = modeService.getProfile('meeting');
  assert.match(meetingProfile.systemDirective, /meeting intelligence copilot/i);

  // In meeting mode, casual discussion does not auto-interrupt
  const classifier = new IntentClassifier();
  const discussionMeta = classifier.classify('Let us discuss the deployment timeline');
  assert.equal(meetingProfile.shouldAutoAnswerSpeech(discussionMeta, 'user'), false);

  // Direct question in meeting mode is answered
  const questionMeta = classifier.classify('What are the action items from this sprint?');
  assert.equal(meetingProfile.shouldAutoAnswerSpeech(questionMeta, 'user'), true);
});

test('30. End-to-End Orchestration: Generates structured suggestion with follow-ups', async () => {
  let emittedSuggestion: SuggestionItem | null = null;
  const orchestrator = new ResponseOrchestrator({
    onEmitSuggestion: (item) => {
      emittedSuggestion = item;
    },
    geminiRequester: async () => ({
      text: JSON.stringify({
        title: 'Binary Search Implementation',
        formatType: 'code',
        content: '```java\npublic int binarySearch(int[] arr, int target) {\n  return -1;\n}\n```',
      }),
      modelUsed: 'gemini-1.5-flash',
    }),
  });

  orchestrator.setSession('session_test_1', 'mock-interview');

  const result = await orchestrator.processUtterance({
    text: 'Write Java code for binary search',
    speaker: 'system',
  });

  assert.equal(result.ok, true);
  const suggestion = emittedSuggestion as SuggestionItem | null;
  assert.ok(suggestion);
  assert.equal(suggestion.title, 'Binary Search Implementation');
  assert.equal(suggestion.intent, 'DSA_PROBLEM');
  assert.equal(suggestion.programmingLanguage, 'java');
  assert.equal(suggestion.formatType, 'code');
  assert.ok(Array.isArray(suggestion.followUpSuggestions));
  assert.ok(suggestion.followUpSuggestions.length > 0);
});
