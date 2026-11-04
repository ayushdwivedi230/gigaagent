import type { SessionMode } from '@shared/types';
import type { IntentMetadata } from './types';
import type { ModeProfile } from './modeConfigurationService';

export interface PromptBuildOptions {
  intentMeta: IntentMetadata;
  profile: ModeProfile;
  priorContext?: string;
  hasScreenContext?: boolean;
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
        categoryInstructions = `Task: Live Interview Response.
Guidelines:
- Deliver an articulate, natural, speakable response suitable for an interview candidate.
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
      ? `\n[Screen Intelligence]: An active, confirmed screenshot of the user's screen is attached. Relate your response directly to the visible code, errors, or diagrams on screen.\n`
      : '';

    const contextNote = priorContext
      ? `\nPrior Conversation Context:\n${priorContext}\n`
      : '';

    return `${profile.systemDirective}

${categoryInstructions}
${screenNote}
${contextNote}
User Question / Instruction:
"${detectedQuestion}"

Return ONLY a valid JSON object matching this schema:
{
  "title": "Concise, descriptive title (under 35 chars)",
  "formatType": "${
    intent === 'CODE_GENERATION' || intent === 'DSA_PROBLEM' || intent === 'SQL_QUERY'
      ? 'code'
      : intent === 'BEHAVIORAL_INTERVIEW' || intent === 'STAR_RESPONSE'
        ? 'star'
        : intent === 'MEETING_SUMMARY' || intent === 'ACTION_ITEMS'
          ? 'meeting'
          : 'technical'
  }",
  "content": "Full formatted response using standard Markdown (bullet points, bold highlights, code blocks with syntax languages). Ensure code is complete and fully runnable."
}`;
  }
}
