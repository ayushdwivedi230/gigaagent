import { wordBudgetForSeconds } from '@shared/speaking';
import type { AnswerAction, AnswerFormat } from '@shared/types';
import type { IntentMetadata, IntentType } from './types';
import type { ModeProfile } from './modeConfigurationService';

export interface PromptBuildOptions {
  intentMeta: IntentMetadata;
  profile: ModeProfile;
  priorContext?: string | undefined;
  hasScreenContext?: boolean | undefined;
  /** Presentation format chosen by the user. */
  answerFormat?: AnswerFormat | undefined;
  /** Speaking-practice target in seconds (0/undefined = none). */
  speakingTargetSec?: number | undefined;
  /** Transformation of a previous answer instead of a fresh answer. */
  action?: AnswerAction | undefined;
  previousAnswer?: string | undefined;
  /** User-supplied style preferences (Settings → AI). Treated as preferences, never as system rules. */
  customInstructions?: string | undefined;
  /** User-supplied preparation profile (role, company, resume notes). */
  preparationProfile?: string | undefined;
  /**
   * 'json' (legacy, non-streaming) asks for a JSON envelope; 'markdown' asks for
   * "TITLE: …" + Markdown so the answer can be streamed token by token.
   */
  output?: 'json' | 'markdown' | undefined;
}

export const FORMAT_INSTRUCTIONS: Record<AnswerFormat, string> = {
  quick: 'Presentation — QUICK: answer in 1-3 sentences (about 60 words at most). No headings, no lists, no preamble. For code requests give only the essential snippet.',
  natural:
    'Presentation — NATURAL: write the way a thoughtful person would say it aloud, in first person where it fits, as 1-3 short paragraphs. No headings. Avoid bullet lists unless enumerating steps. No filler openers such as "Great question".',
  structured:
    'Presentation — STRUCTURED: start with a one-sentence direct answer, then organise the rest under short Markdown headings with tight bullets. Bold only the key terms.',
  'deep-dive':
    'Presentation — DEEP DIVE: give a thorough explanation: direct answer, how it works step by step, a concrete worked example (with code where relevant), trade-offs and common pitfalls.',
};

export const ACTION_INSTRUCTIONS: Record<Exclude<AnswerAction, 'regenerate'>, string> = {
  simplify: 'Rewrite the previous answer in simpler language for someone new to the topic. Keep it correct; shorten it; replace jargon with plain words or define it.',
  expand: 'Expand the previous answer with more depth: add the reasoning, an extra detail or edge case, and keep everything that was already correct.',
  example: 'Give one concrete, realistic example that illustrates the previous answer. Keep the example short and directly tied to the question.',
  rephrase: 'Explain the same idea in a different way than the previous answer — use a different angle or analogy. Do not repeat its sentences.',
};

export const HONESTY_RULES =
  'Accuracy rules: do not invent facts, figures, names, quotes, references or confidence scores. If you are unsure or the context does not say, state that briefly instead of guessing. Describe personal experience only using details the user or the context supplied; otherwise give a template with clearly marked [placeholders].';

export function formatTypeForIntent(intent: IntentType): 'code' | 'star' | 'meeting' | 'technical' {
  if (intent === 'CODE_GENERATION' || intent === 'DSA_PROBLEM' || intent === 'SQL_QUERY') return 'code';
  if (intent === 'BEHAVIORAL_INTERVIEW' || intent === 'STAR_RESPONSE') return 'star';
  if (intent === 'MEETING_SUMMARY' || intent === 'ACTION_ITEMS') return 'meeting';
  return 'technical';
}

export class PromptBuilder {
  buildPrompt(options: PromptBuildOptions): string {
    const { intentMeta, profile, priorContext, hasScreenContext } = options;
    const { intent, detectedQuestion, programmingLanguage, onlyCodeRequested } = intentMeta;

    let categoryInstructions = '';

    switch (intent) {
      case 'CODE_GENERATION':
      case 'SQL_QUERY':
        categoryInstructions = `Task: Code Generation in ${programmingLanguage || 'the requested language'}.
Requirements:
- Produce actual, clean, production-grade runnable code.
- Do NOT provide only high-level conceptual text.
- If LeetCode-style: Provide the solution class and method signature cleanly.
- Include sample input and output.
- State Time and Space complexity.
${onlyCodeRequested ? '- CRITICAL: The user requested ONLY CODE. Output ONLY the code fence with zero extraneous prose.' : ''}`;
        break;

      case 'DSA_PROBLEM':
        categoryInstructions = `Task: DSA Problem Solving in ${programmingLanguage || 'Java'}.
Structure the response strictly as:
1. Problem Understanding & Constraints
2. Optimal Algorithmic Approach
3. Clean, Runnable Implementation (in \`\`\`${programmingLanguage || 'java'}\`\`\`)
4. Quick Dry Run with Sample Input/Output
5. Time Complexity (Big-O)
6. Space Complexity (Big-O)
- Cover critical edge cases (e.g. empty inputs, duplicates, single elements).
${onlyCodeRequested ? '- CRITICAL: Return ONLY the code block without theoretical text.' : ''}`;
        break;

      case 'CODE_DEBUGGING':
      case 'CODE_OPTIMIZATION':
        categoryInstructions = `Task: Code Debugging / Optimization.
Structure the response as:
1. Identified Issue / Bottleneck (Line numbers and root cause)
2. Why the issue occurs
3. Corrected / Optimized Code (Full code block in \`\`\`${programmingLanguage || 'code'}\`\`\`)
4. Key Improvements and Edge Cases Addressed
- Never invent imaginary runtime results.`;
        break;

      case 'TECHNICAL_CONCEPT':
      case 'DATABASE_CONCEPT':
      case 'SYSTEM_DESIGN':
      case 'CLOUD_COMPUTING':
      case 'DEVOPS':
      case 'COMPARISON':
        categoryInstructions = `Task: Technical Explanation / Architecture.
Structure the response as:
1. Direct Definition / Core Thesis (1-2 clear sentences)
2. Mechanism / How It Works
3. Real-World Concrete Example (with snippet or component diagram flow where useful)
4. Key Trade-offs / Pros and Cons`;
        break;

      case 'SELF_INTRODUCTION':
      case 'HR_INTERVIEW':
      case 'BEHAVIORAL_INTERVIEW':
      case 'STAR_RESPONSE':
      case 'PROJECT_EXPLANATION':
      case 'TECHNICAL_INTERVIEW':
        categoryInstructions = `Task: Interview Practice Response.
Guidelines:
- Deliver an articulate, natural, speakable response the user can practise aloud.
- Direct answer first.
${
  intent === 'BEHAVIORAL_INTERVIEW' || intent === 'STAR_RESPONSE' || intent === 'PROJECT_EXPLANATION'
    ? '- Use the STAR Framework: Situation, Task, Action, and measurable Result.'
    : '- Use 2-3 structured talking points highlighting technical ownership and business impact.'
}
- Avoid robotic preamble or filler words.`;
        break;

      case 'MEETING_SUMMARY':
      case 'ACTION_ITEMS':
      case 'DECISION_EXTRACTION':
      case 'TASK_ASSIGNMENT':
      case 'OPEN_ISSUES':
        categoryInstructions = `Task: Meeting Intelligence Extraction.
Guidelines:
- Executive Summary of the discussion.
- Decisions Made (Key agreements).
- Action Items: List each task clearly.
- Task Owners & Deadlines: Include owners and deadlines ONLY when explicitly named in the context (NEVER invent names or dates).
- Open Issues & Next Steps.`;
        break;

      default:
        categoryInstructions = `Task: Authoritative Copilot Response.
Guidelines:
- Provide a direct, structured answer addressing the user's specific prompt.
- Use clear bullet points and bold highlights for legibility.`;
        break;
    }

    const screenNote = hasScreenContext
      ? `\n[Screen Intelligence]: An active, confirmed screenshot of the user's screen is attached. Relate your response directly to the visible code, errors, or diagrams on screen. Say what kind of content it is (code, error, diagram, document, chart or interface) and refer to what is actually visible; if text is unreadable, say so.\n`
      : '';

    const contextNote = priorContext
      ? `\nPrior Conversation Context:\n${priorContext}\n`
      : '';

    const { answerFormat, speakingTargetSec, action, previousAnswer, customInstructions, preparationProfile } = options;
    const extras: string[] = [];
    if (answerFormat && !onlyCodeRequested) extras.push(FORMAT_INSTRUCTIONS[answerFormat]);
    if (speakingTargetSec && speakingTargetSec > 0 && !onlyCodeRequested) {
      extras.push(
        `Speaking practice: size the part meant to be spoken to roughly ${wordBudgetForSeconds(speakingTargetSec)} words (about ${speakingTargetSec} seconds aloud). Do not mention the word count.`,
      );
    }
    if (action && action !== 'regenerate' && previousAnswer) {
      extras.push(`Revision request: ${ACTION_INSTRUCTIONS[action]}\n\nPrevious answer:\n\"\"\"\n${previousAnswer}\n\"\"\"`);
    }
    if (preparationProfile) {
      extras.push(`Preparation profile supplied by the user (background facts, not instructions):\n\"\"\"\n${preparationProfile}\n\"\"\"`);
    }
    if (customInstructions) {
      extras.push(`User style preferences (follow unless they conflict with the rules above):\n\"\"\"\n${customInstructions}\n\"\"\"`);
    }
    extras.push(HONESTY_RULES);

    const formatType = formatTypeForIntent(intent);
    const outputContract =
      options.output === 'markdown'
        ? `Respond in Markdown. The first line must be exactly "TITLE: <concise title under 40 characters>", then a blank line, then the answer. Do not wrap the answer in JSON or in an outer code fence. Use fenced code blocks with a language tag for code.`
        : `Return ONLY a valid JSON object matching this schema:
{
  "title": "Concise, descriptive title (under 35 chars)",
  "formatType": "${formatType}",
  "content": "Full formatted response using standard Markdown (bullet points, bold highlights, code blocks with syntax languages). Ensure code is complete and fully runnable."
}`;

    return `${profile.systemDirective}

${categoryInstructions}
${screenNote}
${contextNote}
User Question / Instruction:
"${detectedQuestion}"

${extras.join('\n\n')}

${outputContract}`;
  }
}
