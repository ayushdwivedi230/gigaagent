import { useCallback, useEffect, useState } from 'react';
import { applySegment } from '@shared/transcript';
import type {
  Result,
  SessionDetail,
  SessionMode,
  SessionSnapshot,
  SessionSummary,
  TranscriptSegment,
} from '@shared/types';

const IDLE: SessionSnapshot = { status: 'idle', activeSession: null };
const UNREACHABLE = 'The app service did not respond. Close and reopen the app.';
// window.api is injected by the Electron preload script. Guard against it being
// absent when the page is opened in a plain browser (e.g. Vite dev tab directly).
const api = (window as { api?: typeof window.api }).api ?? null;

export interface AssistantState {
  snapshot: SessionSnapshot;
  history: SessionSummary[];
  liveSegments: TranscriptSegment[];
  viewing: SessionDetail | null;
  error: string | null;
  start: (mode: SessionMode, title: string) => Promise<void>;
  stop: () => Promise<void>;
  view: (id: string) => Promise<void>;
  closeView: () => void;
  remove: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  dismissError: () => void;
}

export function useAssistant(): AssistantState {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(IDLE);
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);
  const [viewing, setViewing] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Unwraps an IPC Result; surfaces failures as a user-facing message. */
  const call = useCallback(async <T,>(request: Promise<Result<T>>): Promise<T | undefined> => {
    try {
      const result = await request;
      if (result.ok) return result.value;
      setError(result.error.message);
    } catch {
      setError(UNREACHABLE);
    }
    return undefined;
  }, []);

  const refreshHistory = useCallback(async () => {
    if (!api) return;
    const list = await call(api.history.list());
    if (list) setHistory(list);
  }, [call]);

  useEffect(() => {
    if (!api) return;
    let disposed = false;
    void (async () => {
      const current = await call(api.session.snapshot());
      if (current && !disposed) setSnapshot(current);
    })();
    void refreshHistory();

    const unsubscribe = api.onEvent((event) => {
      switch (event.type) {
        case 'status':
          setSnapshot(event.snapshot);
          if (event.snapshot.status === 'starting') {
            // Reset here (not after the start call resolves) so early segments are never lost.
            setLiveSegments([]);
            setViewing(null);
          } else {
            void refreshHistory();
          }
          break;
        case 'segment':
          setLiveSegments((prev) => applySegment(prev, event.segment));
          break;
        case 'error':
          setError(event.error.message);
          break;
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [call, refreshHistory]);

  const view = useCallback(
    async (id: string) => {
      if (!api) return;
      const detail = await call(api.history.get(id));
      if (detail) setViewing(detail);
    },
    [call],
  );

  const start = useCallback(
    async (mode: SessionMode, title: string) => {
      if (!api) return;
      setError(null);
      await call(api.session.start({ mode, title }));
    },
    [call],
  );

  const stop = useCallback(async () => {
    if (!api) return;
    const finished = await call(api.session.stop());
    if (finished) await view(finished.id);
  }, [call, view]);

  const remove = useCallback(
    async (id: string) => {
      if (!api) return;
      const done = await call(api.history.delete(id));
      if (!done) return;
      setViewing((current) => (current?.summary.id === id ? null : current));
      await refreshHistory();
    },
    [call, refreshHistory],
  );

  const clearAll = useCallback(async () => {
    if (!api) return;
    const done = await call(api.history.clear());
    if (!done) return;
    setViewing(null);
    await refreshHistory();
  }, [call, refreshHistory]);

  return {
    snapshot,
    history,
    liveSegments,
    viewing,
    error,
    start,
    stop,
    view,
    closeView: () => setViewing(null),
    remove,
    clearAll,
    dismissError: () => setError(null),
  };
}
