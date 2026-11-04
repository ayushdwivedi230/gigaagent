import type { IntentMetadata, QualityValidationResult } from './types';
import { logDiag } from '../diagnosticsLogger';

export class ResponseQualityController {
  validate(content: string, intentMeta: IntentMetadata): QualityValidationResult {
    const text = content.trim();

    // 1. Emptiness check
    if (!text || text.length < 20) {
      logDiag('QualityController:Failed', 'Response is too short or empty', { length: text.length });
      return {
        valid: false,
        reason: 'Response is too short or empty.',
        retryInstruction: 'Provide a complete, detailed response addressing the user prompt.',
      };
    }

    // 2. Code presence check for Code Generation / DSA / SQL
    const isCodeIntent =
      intentMeta.intent === 'CODE_GENERATION' ||
      intentMeta.intent === 'DSA_PROBLEM' ||
      intentMeta.intent === 'SQL_QUERY' ||
      Boolean(intentMeta.onlyCodeRequested);

    if (isCodeIntent) {
      const hasCodeBlock = /```[\s\S]*?```/.test(text);
      const hasCodeKeywords =
        /\b(class|def|function|public|return|import|SELECT|val|let|const|void|int|vector)\b/.test(
          text,
        );

      if (!hasCodeBlock && !hasCodeKeywords) {
        logDiag('QualityController:Failed', 'Code was requested but omitted in response', {
          intent: intentMeta.intent,
        });
        return {
          valid: false,
          missingCode: true,
          reason: 'User requested code, but the response omitted the actual code implementation.',
          retryInstruction: `CRITICAL: You must provide the actual, complete, runnable code solution in a code block (\`\`\`${intentMeta.programmingLanguage || 'code'}\`\`\`). Do not output only theoretical text.`,
        };
      }
    }

    // 3. Language check
    if (intentMeta.programmingLanguage) {
      const lang = intentMeta.programmingLanguage.toLowerCase();
      // If code block exists, check if language matches or code syntax aligns
      if (lang === 'java' && /\b(def |console\.log|cout <<|#include)\b/.test(text) && !/\b(class|public|System\.out)\b/.test(text)) {
        logDiag('QualityController:Failed', 'Requested Java but returned different language syntax');
        return {
          valid: false,
          wrongLanguage: true,
          reason: `Requested ${lang} but output appeared to use different language syntax.`,
          retryInstruction: `CRITICAL: The solution must be written in ${lang}. Provide valid, standard ${lang} syntax.`,
        };
      }
    }

    return { valid: true };
  }
}
