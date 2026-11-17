/**
 * Minimal, safe Markdown tokenizer for AI answers.
 * Produces a plain data tree; the renderer turns it into React elements.
 * No HTML is ever produced or interpreted, so model output cannot inject markup.
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; c: Inline[] }
  | { t: 'italic'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'heading'; level: 1 | 2 | 3 | 4; c: Inline[] }
  | { t: 'paragraph'; c: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { t: 'code'; lang: string; v: string; closed: boolean }
  | { t: 'quote'; c: Inline[] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { t: 'rule' };

const SAFE_LINK = /^https:\/\/[^\s<>"']+$/i;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()#+\-.!|]/.test(src[i + 1]!)) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ t: 'code', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && src[i + 1] === ch) {
      const end = src.indexOf(ch + ch, i + 2);
      if (end > i + 1) {
        flush();
        out.push({ t: 'bold', c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '*' || (ch === '_' && (i === 0 || /\W/.test(src[i - 1]!)))) {
      const end = src.indexOf(ch, i + 1);
      if (end > i + 1 && src[i + 1] !== ' ' && src[end - 1] !== ' ' && (ch === '*' || end + 1 >= src.length || /\W/.test(src[end + 1]!))) {
        flush();
        out.push({ t: 'italic', c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(src.slice(i));
      if (m) {
        flush();
        const label = parseInline(m[1]!);
        // Only https links become clickable; anything else is shown as plain text.
        if (SAFE_LINK.test(m[2]!)) out.push({ t: 'link', href: m[2]!, c: label });
        else out.push(...label);
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const splitRow = (line: string): string[] =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length) blocks.push({ t: 'paragraph', c: parseInline(para.join(' ')) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s{0,3}(```|~~~)\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      flushPara();
      const body: string[] = [];
      let closed = false;
      for (i++; i < lines.length; i++) {
        if (lines[i]!.trim().startsWith(fence[1]!)) {
          closed = true;
          break;
        }
        body.push(lines[i]!);
      }
      blocks.push({ t: 'code', lang: (fence[2] ?? '').toLowerCase(), v: body.join('\n'), closed });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flushPara();
      blocks.push({ t: 'heading', level: Math.min(4, heading[1]!.length) as 1 | 2 | 3 | 4, c: parseInline(heading[2]!) });
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      blocks.push({ t: 'rule' });
      continue;
    }
    if (/^\s{0,3}>\s?/.test(line)) {
      flushPara();
      const q: string[] = [];
      for (; i < lines.length && /^\s{0,3}>\s?/.test(lines[i]!); i++) q.push(lines[i]!.replace(/^\s{0,3}>\s?/, ''));
      i--;
      blocks.push({ t: 'quote', c: parseInline(q.join(' ')) });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]!)) {
      flushPara();
      const head = splitRow(line).map(parseInline);
      const rows: Inline[][][] = [];
      for (i += 2; i < lines.length && lines[i]!.includes('|') && lines[i]!.trim(); i++) rows.push(splitRow(lines[i]!).map(parseInline));
      i--;
      blocks.push({ t: 'table', head, rows });
      continue;
    }
    const item = /^\s*(?:([-*+])|(\d{1,4})[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const ordered = item[2] !== undefined;
      const start = ordered ? Number(item[2]) : 1;
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const cur = lines[i]!;
        const m = /^\s*(?:([-*+])|(\d{1,4})[.)])\s+(.*)$/.exec(cur);
        if (m && (m[2] !== undefined) === ordered) items.push(m[3]!);
        else if (cur.trim() && /^\s{2,}\S/.test(cur) && items.length && !/^\s*(```|~~~)/.test(cur)) items[items.length - 1] += ` ${cur.trim()}`;
        else break;
      }
      i--;
      blocks.push({ t: 'list', ordered, start, items: items.map(parseInline) });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

/** Plain text of inline nodes (for aria labels, copy and search). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => ('v' in n ? n.v : inlineText(n.c))).join('');
}
