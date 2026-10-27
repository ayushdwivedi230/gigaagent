/** 83_000 -> "01:23"; 3_723_000 -> "1:02:03". Negative / non-finite input is treated as 0. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatStartedAt(iso: string, locale?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export function sessionDurationMs(startedAt: string, endedAt: string | null): number | null {
  if (!endedAt) return null;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) ? Math.max(0, ms) : null;
}
