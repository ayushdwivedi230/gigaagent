import { useCallback, useEffect, useState } from 'react';
import { applySegment } from '@shared/transcript';
import type {
  ClientSettings,
  Result,
  SessionDetail,
  SessionMode,
  SessionSnapshot,
  SessionSummary,
  SourceKind,
  SuggestionItem,
  TranscriptSegment,
  UpdateSettingsRequest,
} from '@shared/types';
import { audioCapture } from '../audio/audioCaptureService';
import { systemAudioCapture } from '../audio/systemAudioCaptureService';

const IDLE: SessionSnapshot = { status: 'idle', activeSession: null };
const UNREACHABLE = 'The app service did not respond. Close and reopen the app.';
export const DESKTOP_REQUIRED_ERROR =
  'Browser preview mode: Desktop IPC is unavailable at localhost:5173. Please use the floating GigaAgent Electron desktop application window for live audio capture and session management.';

// window.api is injected by the Electron preload script. Guard against it being
// absent when the page is opened in a plain browser (e.g. Vite dev tab directly).
const api = (window as { api?: typeof window.api }).api ?? null;

export interface AssistantState {
  snapshot: SessionSnapshot;
  history: SessionSummary[];
  liveSegments: TranscriptSegment[];
  suggestions: SuggestionItem[];
  activeAnswer: SuggestionItem | null;
  isGeneratingAnswer: boolean;
  autoAnswer: boolean;
  setAutoAnswer: (val: boolean) => void;
  viewing: SessionDetail | null;
  error: string | null;
  settings: ClientSettings | null;
  start: (mode: SessionMode, title: string, source?: SourceKind) => Promise<void>;
  stop: () => Promise<void>;
  view: (id: string) => Promise<void>;
  closeView: () => void;
  remove: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  clearLiveSegments: () => void;
  clearAnswer: () => void;
  dismissError: () => void;
  loadSettings: () => Promise<void>;
  saveSettings: (updates: UpdateSettingsRequest) => Promise<void>;
  testGemini: (question?: string) => Promise<SuggestionItem | undefined>;
  askAi: (
    question: string,
    options?: { mode?: SessionMode; context?: string; formatType?: string },
  ) => Promise<SuggestionItem | undefined>;
}

export function useAssistant(): AssistantState {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(IDLE);
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [activeAnswer, setActiveAnswer] = useState<SuggestionItem | null>(null);
  const [isGeneratingAnswer, setIsGeneratingAnswer] = useState(false);
  const [autoAnswer, setAutoAnswer] = useState(true);
  const [viewing, setViewing] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ClientSettings | null>(null);

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

  const loadSettings = useCallback(async () => {
    if (!api) return;
    const s = await call(api.settings.get());
    if (s) setSettings(s);
  }, [call]);

  const saveSettings = useCallback(
    async (updates: UpdateSettingsRequest) => {
      if (!api) return;
      const updated = await call(api.settings.save(updates));
      if (updated) setSettings(updated);
    },
    [call],
  );

  useEffect(() => {
    if (!api) {
      setError(DESKTOP_REQUIRED_ERROR);
      return;
    }
    let disposed = false;
    void (async () => {
      const current = await call(api.session.snapshot());
      if (current && !disposed) setSnapshot(current);
    })();
    void refreshHistory();
    void loadSettings();

    const unsubscribe = api.onEvent((event) => {
      switch (event.type) {
        case 'status':
          setSnapshot(event.snapshot);
          if (event.snapshot.status === 'starting') {
            setLiveSegments([]);
            setSuggestions([]);
            setViewing(null);
          } else if (event.snapshot.status === 'idle') {
            audioCapture.stop();
            void refreshHistory();
          } else {
            void refreshHistory();
          }
          break;
        case 'segment':
          setLiveSegments((prev) => applySegment(prev, event.segment));
          break;
        case 'suggestion':
          setSuggestions((prev) => [event.suggestion, ...prev]);
          if (
            event.suggestion.type === 'answer_tip' ||
            event.suggestion.isQuestion ||
            event.suggestion.source === 'gemini'
          ) {
            setActiveAnswer(event.suggestion);
          }
          break;
        case 'error':
          setError(event.error.message);
          break;
      }
    });
    return () => {
      disposed = true;
      audioCapture.stop();
      unsubscribe();
    };
  }, [call, refreshHistory, loadSettings]);

  const view = useCallback(
    async (id: string) => {
      if (!api) return;
      const detail = await call(api.history.get(id));
      if (detail) setViewing(detail);
    },
    [call],
  );

  const start = useCallback(
    async (mode: SessionMode, title: string, source: SourceKind = 'microphone') => {
      if (!api) {
        setError(DESKTOP_REQUIRED_ERROR);
        return;
      }
      setError(null);

      if (source === 'both') {
        try {
          await Promise.all([
            audioCapture.start({
              onChunk: (buffer) => {
                api.audio.sendChunk('mic', buffer);
              },
              onError: (err) => {
                setError(err.message);
              },
            }),
            systemAudioCapture.start({
              onChunk: (buffer) => {
                api.audio.sendChunk('system', buffer);
              },
              onError: (err) => {
                setError(err.message);
              },
            }),
          ]);
        } catch (bothErr) {
          audioCapture.stop();
          systemAudioCapture.stop();
          setError(
            bothErr instanceof Error
              ? bothErr.message
              : 'Failed to initialize dual audio capture.',
          );
          return;
        }
      } else if (source === 'microphone') {
        try {
          await audioCapture.start({
            onChunk: (buffer) => {
              api.audio.sendChunk('mic', buffer);
            },
            onError: (err) => {
              setError(err.message);
            },
          });
        } catch (captureErr) {
          setError(
            captureErr instanceof Error
              ? captureErr.message
              : 'Failed to access microphone. Check permissions.',
          );
          return;
        }
      } else if (source === 'system') {
        try {
          await systemAudioCapture.start({
            onChunk: (buffer) => {
              api.audio.sendChunk('system', buffer);
            },
            onError: (err) => {
              setError(err.message);
            },
          });
        } catch (sysErr) {
          setError(
            sysErr instanceof Error
              ? sysErr.message
              : 'Failed to capture system audio. Check permissions.',
          );
          return;
        }
      }

      const res = await call(api.session.start({ mode, title, source }));
      if (!res) {
        audioCapture.stop();
        systemAudioCapture.stop();
      }
    },
    [call],
  );

  const stop = useCallback(async () => {
    audioCapture.stop();
    systemAudioCapture.stop();
    if (!api) {
      setError(DESKTOP_REQUIRED_ERROR);
      return;
    }
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

  const testGemini = useCallback(
    async (question?: string) => {
      if (!api) {
        setError(DESKTOP_REQUIRED_ERROR);
        return undefined;
      }
      setIsGeneratingAnswer(true);
      try {
        const res = await call(api.gemini.test(question));
        if (res) setActiveAnswer(res);
        return res;
      } finally {
        setIsGeneratingAnswer(false);
      }
    },
    [call],
  );

  const askAi = useCallback(
    async (
      question: string,
      options?: { mode?: SessionMode; context?: string; formatType?: string },
    ) => {
      if (!api) {
        setError(DESKTOP_REQUIRED_ERROR);
        return undefined;
      }
      setIsGeneratingAnswer(true);
      try {
        const item = await call(api.ai.ask(question, options));
        if (item) {
          setActiveAnswer(item);
          return item;
        }
      } finally {
        setIsGeneratingAnswer(false);
      }
      return undefined;
    },
    [call],
  );

  return {
    snapshot,
    history,
    liveSegments,
    suggestions,
    activeAnswer,
    isGeneratingAnswer,
    autoAnswer,
    setAutoAnswer,
    viewing,
    error,
    settings,
    start,
    stop,
    view,
    closeView: () => setViewing(null),
    remove,
    clearAll,
    clearLiveSegments: () => setLiveSegments([]),
    clearAnswer: () => setActiveAnswer(null),
    dismissError: () => setError(null),
    loadSettings,
    saveSettings,
    testGemini,
    askAi,
  };
}
