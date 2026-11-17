import { formatClock, sessionDurationMs } from './format';
import { MODE_LABELS } from './types';
import type { ExportFormat, LibraryItem, SessionDetail } from './types';

export interface ExportOptions {
  includeTranscript?: boolean;
  includeAnswers?: boolean;
  includeSaved?: boolean;
  /** Fixed timestamp for deterministic output in tests. */
  exportedAt?: string;
}

const speakerLabel = (speaker: string): string => (speaker === 'system' ? 'Other speaker' : 'You');

/** Windows-safe file name stem derived from the session title. */
export function exportFileStem(detail: SessionDetail): string {
  const date = detail.summary.startedAt.slice(0, 10);
  const title = detail.summary.title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 60);
  const stem = `${title || 'session'} ${date}`.trim();
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(title) ? `session ${date}` : stem;
}

export function buildSessionExport(
  detail: SessionDetail,
  saved: LibraryItem[],
  format: ExportFormat,
  options: ExportOptions = {},
): string {
  const { includeTranscript = true, includeAnswers = true, includeSaved = true } = options;
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const { summary } = detail;
  const segments = includeTranscript ? detail.segments.filter((s) => s.isFinal) : [];
  const answers = includeAnswers ? (detail.suggestions ?? []) : [];
  const items = includeSaved ? saved : [];
  const duration = sessionDurationMs(summary.startedAt, summary.endedAt);

  if (format === 'json') {
    return JSON.stringify(
      { app: 'GigaAgent', exportVersion: 1, exportedAt, session: summary, transcript: segments, answers, saved: items },
      null,
      2,
    );
  }

  const md = format === 'markdown';
  const h = (level: number, text: string): string => (md ? `${'#'.repeat(level)} ${text}` : level === 1 ? `${text}\n${'='.repeat(text.length)}` : `${text}\n${'-'.repeat(text.length)}`);
  const out: string[] = [h(1, summary.title), ''];
  const meta = [
    ['Mode', MODE_LABELS[summary.mode] ?? summary.mode],
    ['Started', summary.startedAt],
    ['Duration', duration === null ? 'in progress' : formatClock(duration)],
    ['Audio source', summary.source],
    ['Exported', exportedAt],
  ];
  for (const [k, v] of meta) out.push(md ? `- **${k}:** ${v}` : `${k}: ${v}`);
  out.push('');

  if (includeTranscript) {
    out.push(h(2, 'Transcript'), '');
    if (segments.length === 0) out.push(md ? '_No transcript was recorded._' : 'No transcript was recorded.', '');
    for (const s of segments) {
      const stamp = formatClock(s.startMs);
      out.push(md ? `**[${stamp}] ${speakerLabel(s.speaker)}:** ${s.text}` : `[${stamp}] ${speakerLabel(s.speaker)}: ${s.text}`, md ? '' : '');
    }
  }
  if (includeAnswers && answers.length) {
    out.push(h(2, 'AI answers'), '');
    for (const a of answers) {
      out.push(h(3, a.title));
      if (a.question) out.push('', md ? `> ${a.question.replace(/\n/g, ' ')}` : `Question: ${a.question}`);
      out.push('', a.content, '');
    }
  }
  if (includeSaved && items.length) {
    out.push(h(2, 'Saved items'), '');
    for (const item of items) out.push(h(3, `${item.title} (${item.kind})`), '', item.content, '');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
