/** Speaking-time estimation for practice answers. Pure; shared by main (prompt sizing) and renderer (display). */
export const WORDS_PER_MINUTE = 140;

/** Strips Markdown syntax and code blocks so only words a person would say aloud are counted. */
export function spokenText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countSpokenWords(markdown: string): number {
  const text = spokenText(markdown);
  return text ? text.split(' ').length : 0;
}

/** Estimated seconds to say the answer aloud at a conversational pace. 0 for empty / code-only text. */
export function estimateSpeakingSeconds(markdown: string, wpm: number = WORDS_PER_MINUTE): number {
  const words = countSpokenWords(markdown);
  return words === 0 ? 0 : Math.max(1, Math.round((words / wpm) * 60));
}

export function wordBudgetForSeconds(seconds: number, wpm: number = WORDS_PER_MINUTE): number {
  return Math.max(0, Math.round((seconds / 60) * wpm));
}

/** "~45 sec" / "~1 min 20 sec". Labelled as an estimate wherever it is shown. */
export function formatSpeakingTime(seconds: number): string {
  if (seconds <= 0) return '';
  if (seconds < 60) return `~${seconds} sec`;
  const m = Math.floor(seconds / 60);
  const s = Math.round((seconds % 60) / 5) * 5;
  return s === 0 || s === 60 ? `~${s === 60 ? m + 1 : m} min` : `~${m} min ${s} sec`;
}
