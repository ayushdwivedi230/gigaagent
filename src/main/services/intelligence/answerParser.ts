/**
 * Parses model output into { title, content }.
 * Accepts the streaming-friendly "TITLE: …" + Markdown contract as well as the legacy JSON envelope,
 * so older prompts, tests and non-streaming calls keep working.
 */
export interface ParsedAnswer {
  title?: string | undefined;
  formatType?: string | undefined;
  content?: string | undefined;
}

const TITLE_LINE = /^\s*(?:\*\*)?title(?:\*\*)?\s*:\s*(.+?)\s*(?:\*\*)?\s*$/i;

function tryJson(raw: string): ParsedAnswer | null {
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const candidates = [cleaned];
  const match = /(\[[\s\S]*\]|\{[\s\S]*\})/.exec(raw);
  if (match) candidates.push(match[0]);
  for (const text of candidates) {
    if (!/^[[{]/.test(text)) continue;
    try {
      let parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) parsed = parsed[0];
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const o = parsed as Record<string, unknown>;
        const out: ParsedAnswer = {};
        if (typeof o.title === 'string') out.title = o.title;
        if (typeof o.formatType === 'string') out.formatType = o.formatType;
        if (typeof o.content === 'string') out.content = o.content;
        return out;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function parseAnswer(raw: string): ParsedAnswer {
  const trimmed = raw.trim();
  if (/^(```json|\{|\[\s*\{)/i.test(trimmed)) {
    const json = tryJson(trimmed);
    if (json) return json;
  }
  const nl = trimmed.indexOf('\n');
  const first = nl === -1 ? trimmed : trimmed.slice(0, nl);
  const m = TITLE_LINE.exec(first);
  if (m && nl !== -1) {
    return { title: m[1]!.replace(/^["']|["']$/g, '').slice(0, 80), content: trimmed.slice(nl + 1).trim() };
  }
  // Last resort for prose that embeds a JSON object.
  if (trimmed.includes('"content"')) {
    const json = tryJson(trimmed);
    if (json?.content) return json;
  }
  return { content: trimmed };
}

/**
 * Body text to show while a response is still streaming: hides the "TITLE:" line (even while it
 * is only partially received) and hides a JSON envelope until it can be parsed.
 */
export function streamingBody(accumulated: string): string {
  const text = accumulated.replace(/^\s+/, '');
  if (!text) return '';
  if (/^(```json|\{)/i.test(text)) return parseAnswer(text).content && tryJson(text) ? (tryJson(text)?.content ?? '') : '';
  const nl = text.indexOf('\n');
  if (nl === -1) {
    const head = text.replace(/^\*\*/, '').toLowerCase();
    const partialTitle = head.startsWith('title') || 'title:'.startsWith(head.slice(0, 6));
    return partialTitle ? '' : text;
  }
  return TITLE_LINE.test(text.slice(0, nl)) ? text.slice(nl + 1).replace(/^\s+/, '') : text;
}
