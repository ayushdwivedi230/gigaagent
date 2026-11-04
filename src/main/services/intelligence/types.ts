import type { SessionMode, SuggestionItem } from '@shared/types';

export const TECHNICAL_INTENTS = [
  'CODE_GENERATION',
  'DSA_PROBLEM',
  'CODE_EXPLANATION',
  'CODE_DEBUGGING',
  'CODE_OPTIMIZATION',
  'SQL_QUERY',
  'DATABASE_CONCEPT',
  'SYSTEM_DESIGN',
  'TECHNICAL_CONCEPT',
  'CLOUD_COMPUTING',
  'DEVOPS',
  'COMPARISON',
] as const;

export const INTERVIEW_INTENTS = [
  'TECHNICAL_INTERVIEW',
  'HR_INTERVIEW',
  'BEHAVIORAL_INTERVIEW',
  'STAR_RESPONSE',
  'SELF_INTRODUCTION',
  'PROJECT_EXPLANATION',
  'FOLLOW_UP_INTERVIEW',
  'RESUME_QUESTION',
] as const;

export const MEETING_INTENTS = [
  'MEETING_SUMMARY',
  'ACTION_ITEMS',
  'DECISION_EXTRACTION',
  'FOLLOW_UP_QUESTION',
  'DISCUSSION',
  'TASK_ASSIGNMENT',
  'OPEN_ISSUES',
] as const;

export const GENERAL_INTENTS = [
  'GENERAL_QUESTION',
  'EXPLANATION',
  'DEFINITION',
  'HOW_TO',
  'SUMMARY',
  'COMPARISON',
  'CONVERSATIONAL',
  'CLARIFICATION',
  'ACKNOWLEDGEMENT',
  'UNKNOWN',
] as const;

export type IntentType =
  | (typeof TECHNICAL_INTENTS)[number]
  | (typeof INTERVIEW_INTENTS)[number]
  | (typeof MEETING_INTENTS)[number]
  | (typeof GENERAL_INTENTS)[number];

export type ExpectedResponseFormat =
  | 'code'
  | 'dsa'
  | 'technical'
  | 'interview_star'
  | 'interview_spoken'
  | 'meeting_summary'
  | 'action_items'
  | 'explanation'
  | 'conversational';

export interface IntentMetadata {
  intent: IntentType;
  confidence: number;
  detectedQuestion: string;
  relevantEntities: string[];
  expectedResponseFormat: ExpectedResponseFormat;
  needsAnswer: boolean;
  requiresPreviousContext: boolean;
  programmingLanguage?: string;
  isFollowUp?: boolean;
  onlyCodeRequested?: boolean;
}

export interface QuestionDetectionResult {
  isQuestionOrInstruction: boolean;
  isExplicitQuestion: boolean;
  isInstruction: boolean;
  isFollowUp: boolean;
  isAcknowledgement: boolean;
  isGreeting: boolean;
  cleanText: string;
}

export interface ConversationTurn {
  id: string;
  speaker: 'user' | 'system';
  text: string;
  intent?: IntentType;
  detectedQuestion?: string;
  timestamp: string;
  aiResponse?: string;
  programmingLanguage?: string;
}

export interface ContextSnapshot {
  activeTopic?: string;
  primaryLanguage?: string;
  recentTurns: ConversationTurn[];
  recentQuestions: string[];
  importantEntities: Record<string, string>;
  unresolvedQuestions: string[];
  hasScreenContext: boolean;
}

export interface QualityValidationResult {
  valid: boolean;
  reason?: string;
  missingCode?: boolean;
  wrongLanguage?: boolean;
  retryInstruction?: string;
}

export interface OrchestrationRequest {
  text: string;
  speaker?: 'user' | 'system';
  mode?: SessionMode;
  context?: string;
  isManual?: boolean;
  sessionId?: string;
  screenshotBase64?: string;
}
