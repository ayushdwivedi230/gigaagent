/**
 * Tiny external store for audio levels. Meters subscribe and paint straight to the DOM,
 * so 10 updates/second never re-render the React tree.
 */
export type LevelSource = 'mic' | 'system';
type Listener = (level: number) => void;

const listeners: Record<LevelSource, Set<Listener>> = { mic: new Set(), system: new Set() };
const current: Record<LevelSource, number> = { mic: 0, system: 0 };
const lastChunkAt: Record<LevelSource, number> = { mic: 0, system: 0 };

export function pushLevel(source: LevelSource, level: number): void {
  // Fast attack, slow release reads naturally on a meter.
  current[source] = level > current[source] ? level : current[source] * 0.7 + level * 0.3;
  lastChunkAt[source] = Date.now();
  for (const l of listeners[source]) l(current[source]);
}

export function resetLevels(): void {
  for (const source of ['mic', 'system'] as const) {
    current[source] = 0;
    lastChunkAt[source] = 0;
    for (const l of listeners[source]) l(0);
  }
}

export function subscribeLevel(source: LevelSource, listener: Listener): () => void {
  listeners[source].add(listener);
  listener(current[source]);
  return () => {
    listeners[source].delete(listener);
  };
}

/** Milliseconds since audio last arrived from a source (Infinity if never). Used by diagnostics. */
export function msSinceAudio(source: LevelSource): number {
  return lastChunkAt[source] ? Date.now() - lastChunkAt[source] : Number.POSITIVE_INFINITY;
}
