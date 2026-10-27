import { useEffect, useState } from 'react';

/** Milliseconds since `startedAt` (ISO string), ticking while it is set. 0 when null. */
export function useElapsed(startedAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [startedAt]);

  if (!startedAt) return 0;
  const start = Date.parse(startedAt);
  return Number.isFinite(start) ? Math.max(0, now - start) : 0;
}
