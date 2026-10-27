import type { TranscriptSegment } from './types';

/**
 * Merge an incoming segment into a transcript list without mutating it.
 * - Unknown id: appended.
 * - Same id: replaced (interim results are refined in place until final).
 * - A late interim result for an already-final segment is ignored (same array returned).
 */
export function applySegment(
  list: TranscriptSegment[],
  incoming: TranscriptSegment,
): TranscriptSegment[] {
  const index = list.findIndex((s) => s.id === incoming.id);
  if (index === -1) return [...list, incoming];
  const existing = list[index];
  if (existing?.isFinal && !incoming.isFinal) return list;
  const next = [...list];
  next[index] = incoming;
  return next;
}
