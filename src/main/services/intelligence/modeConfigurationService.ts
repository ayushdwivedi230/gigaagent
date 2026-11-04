import type { SessionMode } from '@shared/types';
import type { IntentMetadata } from './types';

export interface ModeProfile {
  mode: SessionMode;
  roleDescription: string;
  defaultFormat: string;
  shouldAutoAnswerSpeech: (intentMeta: IntentMetadata, speaker: 'user' | 'system') => boolean;
  systemDirective: string;
}

export class ModeConfigurationService {
  getProfile(mode: SessionMode): ModeProfile {
    switch (mode) {
      case 'mock-interview':
        return {
          mode: 'mock-interview',
          roleDescription: 'Elite Technical & Behavioral Interview Copilot',
          defaultFormat: 'interview_spoken',
          shouldAutoAnswerSpeech: (meta, speaker) => {
            // In interview, respond to all questions from interviewer (system) or candidate (user)
            if (!meta.needsAnswer) return false;
            return true;
          },
          systemDirective: `You are GigaAgent, an elite real-time copilot for a live job interview.
Your goal is to provide articulate, technically rigorous, natural answers suitable for speaking aloud.
- Give the direct core answer in the very first sentence.
- Use 2-4 crisp bullet points detailing implementation, mechanisms, or trade-offs.
- For behavioral questions, use Situation, Task, Action, Result (STAR).
- For DSA / Coding: Provide the optimal solution with complete runnable code and Big-O time/space complexity.
- Avoid robotic preamble or filler.`,
        };

      case 'meeting':
        return {
          mode: 'meeting',
          roleDescription: 'Strategic Meeting Assistant & Action Tracker',
          defaultFormat: 'action_items',
          shouldAutoAnswerSpeech: (meta, _speaker) => {
            // In meeting mode, DO NOT interrupt casual discussions.
            // Only respond if it is explicitly an action item, meeting summary, decision query, or direct question.
            if (!meta.needsAnswer) return false;
            const meetingTriggers = [
              'MEETING_SUMMARY',
              'ACTION_ITEMS',
              'DECISION_EXTRACTION',
              'FOLLOW_UP_QUESTION',
              'GENERAL_QUESTION',
              'TECHNICAL_CONCEPT',
            ];
            return meetingTriggers.includes(meta.intent);
          },
          systemDirective: `You are GigaAgent, an executive meeting intelligence copilot.
Your goal is to extract actionable value without interrupting casual conversational flow:
- Summarize discussions with high clarity.
- Extract concrete Decisions and Action Items.
- Attribute Task Owners and Deadlines ONLY when explicitly mentioned in speech (NEVER invent names or dates).
- Highlight open risks and unresolved blockers.`,
        };

      case 'study':
      case 'general':
      default:
        return {
          mode: mode || 'general',
          roleDescription: 'Authoritative Technical & General Copilot',
          defaultFormat: 'technical',
          shouldAutoAnswerSpeech: (meta, _speaker) => {
            return meta.needsAnswer;
          },
          systemDirective: `You are GigaAgent, an expert desktop AI copilot.
Provide clear, authoritative, highly structured answers:
- Provide direct answers first, followed by clear explanations and concrete examples.
- For code: produce complete, clean, runnable code with input/output and complexity analysis.
- Respect the user's requested language and constraints.`,
        };
    }
  }
}
