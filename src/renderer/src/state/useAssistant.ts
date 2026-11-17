import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applySegment } from '@shared/transcript';
import { DEFAULT_PREFERENCES } from '@shared/settings';
import type {
  AnswerAction,
  AnswerFormat,
  AskOptions,
  ClientSettings,
  DeepPartial,
  DesktopSourceInfo,
  ExportFormat,
  InvisibilityStatus,
  LibraryItem,
  LibraryQuery,
  ModeToolId,
  Preferences,
  Result,
  SaveLibraryItemRequest,
  ScreenshotData,
  SessionDetail,
  SessionMode,
  SessionSnapshot,
  SessionSummary,
  ShortcutAction,
  SourceKind,
  SuggestionItem,
  TranscriptSearchHit,
  TranscriptSegment,
  UpdateSettingsRequest,
  WindowMode,
} from '@shared/types';
import { audioCapture, listAudioInputs, pcmLevel } from '../audio/audioCaptureService';
import type { AudioInputDevice } from '../audio/audioCaptureService';
import { systemAudioCapture } from '../audio/systemAudioCaptureService';
import { pushLevel, resetLevels } from './levels';

const IDLE: SessionSnapshot = { status: 'idle', activeSession: null };
const UNREACHABLE = 'The app service did not respond. Close and reopen the app.';
export const DESKTOP_REQUIRED_ERROR =
  'Browser preview: the desktop bridge is unavailable here. Open the GigaAgent desktop window for audio capture and sessions.';

/** Transcript rows kept in memory for the live view. Older rows stay in the database. */
export const MAX_LIVE_SEGMENTS = 2000;
const MAX_ANSWERS = 100;

// window.api is injected by the Electron preload script. Guard against it being
// absent when the page is opened in a plain browser (e.g. Vite dev tab directly).
const api = (window as { api?: typeof window.api }).api ?? null;

export interface Notice {
  id: number;
  kind: 'error' | 'info' | 'success';
  text: string;
}

export interface StreamingAnswer {
  requestId: string;
  question: string;
  text: string;
  startedAt: number;
}

export interface AssistantState {
  ready: boolean;
  snapshot: SessionSnapshot;
  history: SessionSummary[];
  liveSegments: TranscriptSegment[];
  /** Newest first. Includes automatic tips and tool results. */
  answers: SuggestionItem[];
  activeAnswer: SuggestionItem | null;
  streaming: StreamingAnswer | null;
  isGenerating: boolean;
  viewing: SessionDetail | null;
  notice: Notice | null;
  /** Short status text announced to screen readers (never streamed text). */
  announcement: string;
  settings: ClientSettings | null;
  prefs: Preferences;
  ghost: InvisibilityStatus | null;
  windowMode: WindowMode;
  micDevices: AudioInputDevice[];
  micLabel: string | null;
  library: LibraryItem[];
  shortcut: { action: ShortcutAction; at: number } | null;

  start: (mode: SessionMode, source: SourceKind) => Promise<void>;
  stop: () => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
  view: (id: string) => Promise<void>;
  closeView: () => void;
  remove: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  searchHistory: (query: string) => Promise<TranscriptSearchHit[]>;
  exportSession: (sessionId: string, format: ExportFormat) => Promise<void>;
  backup: () => Promise<void>;
  wipeData: () => Promise<void>;
  clearLiveSegments: () => void;
  selectAnswer: (answer: SuggestionItem | null) => void;
  notify: (kind: Notice['kind'], text: string) => void;
  dismissNotice: () => void;
  saveSettings: (updates: UpdateSettingsRequest) => Promise<boolean>;
  updatePrefs: (patch: DeepPartial<Preferences>) => Promise<void>;
  setGhost: (enabled: boolean) => Promise<void>;
  setWindowMode: (mode: WindowMode) => Promise<void>;
  testGemini: () => Promise<SuggestionItem | undefined>;
  ask: (question: string, options?: AskOptions) => Promise<SuggestionItem | undefined>;
  reviseAnswer: (answer: SuggestionItem, action: AnswerAction, format?: AnswerFormat) => Promise<void>;
  runTool: (tool: ModeToolId, input?: string) => Promise<void>;
  cancel: () => void;
  refreshMicDevices: () => Promise<void>;
  refreshLibrary: (query?: LibraryQuery) => Promise<void>;
  saveToLibrary: (item: SaveLibraryItemRequest) => Promise<LibraryItem | undefined>;
  deleteFromLibrary: (id: string) => Promise<void>;
  isSaved: (answer: SuggestionItem) => boolean;

  screenSources: DesktopSourceInfo[];
  selectedSourceId: string | undefined;
  setSelectedSourceId: (id: string | undefined) => void;
  pendingScreenshot: ScreenshotData | null;
  activeScreenshot: ScreenshotData | null;
  isCapturingScreen: boolean;
  loadScreenSources: () => Promise<void>;
  captureScreen: (sourceId?: string) => Promise<void>;
  confirmScreenshot: () => Promise<void>;
  discardScreenshot: () => Promise<void>;
  clearScreenContext: () => Promise<void>;
  analyzeScreen: (question: string) => Promise<void>;
}

let requestCounter = 0;
const newRequestId = (): string => `r${Date.now().toString(36)}_${(++requestCounter).toString(36)}`;

export function useAssistant(): AssistantState {
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(IDLE);
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);
  const [answers, setAnswers] = useState<SuggestionItem[]>([]);
  const [activeAnswer, setActiveAnswer] = useState<SuggestionItem | null>(null);
  const [streaming, setStreaming] = useState<StreamingAnswer | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [viewing, setViewing] = useState<SessionDetail | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [settings, setSettings] = useState<ClientSettings | null>(null);
  const [ghost, setGhostStatus] = useState<InvisibilityStatus | null>(null);
  const [windowMode, setWindowModeState] = useState<WindowMode>('compact');
  const [micDevices, setMicDevices] = useState<AudioInputDevice[]>([]);
  const [micLabel, setMicLabel] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [shortcut, setShortcut] = useState<{ action: ShortcutAction; at: number } | null>(null);

  const [screenSources, setScreenSources] = useState<DesktopSourceInfo[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | undefined>(undefined);
  const [pendingScreenshot, setPendingScreenshot] = useState<ScreenshotData | null>(null);
  const [activeScreenshot, setActiveScreenshot] = useState<ScreenshotData | null>(null);
  const [isCapturingScreen, setIsCapturingScreen] = useState(false);

  const currentRequest = useRef<string | null>(null);
  const noticeId = useRef(0);
  const prefs = settings?.preferences ?? DEFAULT_PREFERENCES;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const modeRef = useRef<SessionMode>(prefs.audio.defaultMode);
  // Questions are answered in the running session's mode, otherwise in the selected mode.
  modeRef.current = snapshot.activeSession?.mode ?? prefs.audio.defaultMode;

  const notify = useCallback((kind: Notice['kind'], text: string) => {
    setNotice({ id: ++noticeId.current, kind, text });
    setAnnouncement(text);
  }, []);

  /** Unwraps an IPC Result; surfaces failures as a user-facing message. */
  const call = useCallback(
    async <T,>(request: Promise<Result<T>>, quiet = false): Promise<T | undefined> => {
      try {
        const result = await request;
        if (result.ok) return result.value;
        if (!quiet && result.error.code !== 'CANCELLED') notify('error', result.error.message);
      } catch {
        if (!quiet) notify('error', UNREACHABLE);
      }
      return undefined;
    },
    [notify],
  );

  const refreshHistory = useCallback(async () => {
    if (!api) return;
    const list = await call(api.history.list());
    if (list) setHistory(list);
  }, [call]);

  const refreshLibrary = useCallback(
    async (query?: LibraryQuery) => {
      if (!api) return;
      const items = await call(api.library.list(query));
      if (items) setLibrary(items);
    },
    [call],
  );

  const refreshMicDevices = useCallback(async () => {
    try {
      setMicDevices(await listAudioInputs());
    } catch {
      setMicDevices([]);
    }
  }, []);

  const stopCapture = useCallback(() => {
    audioCapture.stop();
    systemAudioCapture.stop();
    setMicLabel(null);
    resetLevels();
  }, []);

  useEffect(() => {
    if (!api) {
      notify('info', DESKTOP_REQUIRED_ERROR);
      setReady(true);
      return;
    }
    let disposed = false;
    void (async () => {
      const [current, s, g] = await Promise.all([call(api.session.snapshot()), call(api.settings.get()), call(api.invisibility.getStatus(), true)]);
      if (disposed) return;
      if (current) setSnapshot(current);
      if (s) {
        setSettings(s);
        setWindowModeState(s.preferences.layout.expanded ? 'expanded' : 'compact');
      }
      if (g) setGhostStatus(g);
      setReady(true);
      const activeCtx = await call(api.screen.getContext(), true);
      if (activeCtx && !disposed) setActiveScreenshot(activeCtx);
    })();
    void refreshHistory();
    void refreshLibrary();
    void refreshMicDevices();

    const onDeviceChange = (): void => void refreshMicDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);

    const unsubscribe = api.onEvent((event) => {
      switch (event.type) {
        case 'status':
          setSnapshot(event.snapshot);
          if (event.snapshot.status === 'starting') {
            setLiveSegments([]);
            setViewing(null);
          } else if (event.snapshot.status === 'idle') {
            stopCapture();
            void refreshHistory();
          }
          break;
        case 'segment':
          setLiveSegments((prev) => {
            const updated = applySegment(prev, event.segment);
            return updated.length > MAX_LIVE_SEGMENTS ? updated.slice(-MAX_LIVE_SEGMENTS) : updated;
          });
          break;
        case 'suggestion': {
          const item = event.suggestion;
          setAnswers((prev) => {
            if (prev.some((p) => p.id === item.id)) return prev;
            const next = [item, ...prev];
            return next.length > MAX_ANSWERS ? next.slice(0, MAX_ANSWERS) : next;
          });
          // Automatic answers take the stage only when the user is not mid-request.
          if (!currentRequest.current && (item.type === 'answer_tip' || item.isQuestion)) {
            setActiveAnswer(item);
            setAnnouncement(`New answer: ${item.title}`);
          }
          break;
        }
        case 'answer-delta':
          if (event.requestId === currentRequest.current) {
            setStreaming((prev) => (prev && prev.requestId === event.requestId ? { ...prev, text: event.text } : prev));
          }
          break;
        case 'ghost':
          setGhostStatus(event.status);
          break;
        case 'window-mode':
          setWindowModeState(event.mode);
          break;
        case 'shortcut':
          setShortcut({ action: event.action, at: Date.now() });
          break;
        case 'error':
          notify('error', event.error.message);
          break;
      }
    });
    return () => {
      disposed = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
      stopCapture();
      unsubscribe();
    };
  }, [call, notify, refreshHistory, refreshLibrary, refreshMicDevices, stopCapture]);

  const saveSettings = useCallback(
    async (updates: UpdateSettingsRequest) => {
      if (!api) return false;
      const updated = await call(api.settings.save(updates));
      if (updated) setSettings(updated);
      return Boolean(updated);
    },
    [call],
  );

  const updatePrefs = useCallback(
    async (patch: DeepPartial<Preferences>) => {
      // Optimistic: appearance and layout changes must feel instant.
      setSettings((prev) => (prev ? { ...prev, preferences: mergePrefs(prev.preferences, patch) } : prev));
      if (!api) return;
      const updated = await call(api.settings.save({ preferences: patch }));
      if (updated) setSettings(updated);
    },
    [call],
  );

  const setGhost = useCallback(
    async (enabled: boolean) => {
      if (!api) return;
      setGhostStatus((prev) => (prev && prev.supported !== false ? { ...prev, state: 'applying' } : prev));
      const status = await call(api.invisibility.setEnabled(enabled));
      if (status) {
        setGhostStatus(status);
        setSettings((prev) => (prev ? { ...prev, screenShareInvisibility: status.enabled } : prev));
        setAnnouncement(status.state === 'active' ? 'Ghost Mode on' : status.state === 'off' ? 'Ghost Mode off' : `Ghost Mode ${status.state ?? ''}`);
      } else {
        const fresh = await call(api.invisibility.getStatus(), true);
        if (fresh) setGhostStatus(fresh);
      }
    },
    [call],
  );

  const setWindowMode = useCallback(
    async (mode: WindowMode) => {
      setWindowModeState(mode);
      setSettings((prev) => (prev ? { ...prev, preferences: mergePrefs(prev.preferences, { layout: { expanded: mode === 'expanded' } }) } : prev));
      if (api) await call(api.window.setMode(mode));
    },
    [call],
  );

  const view = useCallback(
    async (id: string) => {
      if (!api) return;
      const detail = await call(api.history.get(id));
      if (detail) setViewing(detail);
    },
    [call],
  );

  const start = useCallback(
    async (mode: SessionMode, source: SourceKind) => {
      if (!api) {
        notify('info', DESKTOP_REQUIRED_ERROR);
        return;
      }
      setNotice(null);
      const onError = (err: Error): void => notify('error', err.message);
      const mic = (): Promise<void> =>
        audioCapture.start(
          {
            onChunk: (buffer) => {
              pushLevel('mic', pcmLevel(buffer));
              api.audio.sendChunk('mic', buffer);
            },
            onError,
            onEnded: () => notify('error', 'The microphone was disconnected. Stop the session, reconnect it, and start again.'),
          },
          { deviceId: prefsRef.current.audio.micDeviceId },
        );
      const system = (): Promise<void> =>
        systemAudioCapture.start({
          onChunk: (buffer) => {
            pushLevel('system', pcmLevel(buffer));
            api.audio.sendChunk('system', buffer);
          },
          onError,
        });

      try {
        if (source === 'both') await Promise.all([mic(), system()]);
        else if (source === 'microphone') await mic();
        else if (source === 'system') await system();
      } catch (cause) {
        stopCapture();
        notify('error', cause instanceof Error ? cause.message : 'Audio capture could not start. Check your audio devices and permissions.');
        return;
      }
      setMicLabel(audioCapture.activeDeviceLabel);
      void refreshMicDevices(); // labels become available once permission is granted

      const res = await call(api.session.start({ mode, source }));
      if (!res) stopCapture();
      else setAnnouncement(source === 'demo' ? 'Demo session started' : 'Recording started');
    },
    [call, notify, refreshMicDevices, stopCapture],
  );

  const stop = useCallback(async () => {
    stopCapture();
    if (!api) return;
    const finished = await call(api.session.stop());
    if (finished) setAnnouncement('Session stopped and saved to history');
  }, [call, stopCapture]);

  const setPaused = useCallback(
    async (paused: boolean) => {
      if (!api) return;
      const res = await call(api.session.setPaused(paused));
      if (!res) return;
      audioCapture.setMuted(res.paused);
      systemAudioCapture.setMuted(res.paused);
      if (res.paused) resetLevels();
      setAnnouncement(res.paused ? 'Session paused. Audio is being discarded.' : 'Session resumed');
    },
    [call],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!api) return;
      const done = await call(api.history.delete(id));
      if (!done) return;
      setViewing((current) => (current?.summary.id === id ? null : current));
      await refreshHistory();
      void refreshLibrary();
      setAnnouncement('Session deleted');
    },
    [call, refreshHistory, refreshLibrary],
  );

  const clearAll = useCallback(async () => {
    if (!api) return;
    const done = await call(api.history.clear());
    if (!done) return;
    setViewing(null);
    await refreshHistory();
    notify('success', `Deleted ${done.deleted} session${done.deleted === 1 ? '' : 's'}.`);
  }, [call, notify, refreshHistory]);

  const searchHistory = useCallback(
    async (query: string) => {
      if (!api) return [];
      return (await call(api.history.search(query), true)) ?? [];
    },
    [call],
  );

  const exportSession = useCallback(
    async (sessionId: string, format: ExportFormat) => {
      if (!api) return;
      const res = await call(api.data.exportSession({ sessionId, format }));
      if (res?.saved) notify('success', `Exported to ${res.path ?? 'the chosen file'}.`);
    },
    [call, notify],
  );

  const backup = useCallback(async () => {
    if (!api) return;
    const res = await call(api.data.backup());
    if (res?.saved) notify('success', `Backup saved to ${res.path ?? 'the chosen file'}.`);
  }, [call, notify]);

  const wipeData = useCallback(async () => {
    if (!api) return;
    const res = await call(api.data.wipe());
    if (!res) return;
    setViewing(null);
    setAnswers([]);
    setActiveAnswer(null);
    setLiveSegments([]);
    setActiveScreenshot(null);
    setPendingScreenshot(null);
    await Promise.all([refreshHistory(), refreshLibrary()]);
    notify('success', `Deleted ${res.sessions} session${res.sessions === 1 ? '' : 's'} and ${res.libraryItems} saved item${res.libraryItems === 1 ? '' : 's'}.`);
  }, [call, notify, refreshHistory, refreshLibrary]);

  /** Runs one generation with streaming + cancellation bookkeeping. */
  const generate = useCallback(
    async (label: string, run: (requestId: string) => Promise<Result<SuggestionItem>>): Promise<SuggestionItem | undefined> => {
      if (!api) {
        notify('info', DESKTOP_REQUIRED_ERROR);
        return undefined;
      }
      // A new question replaces the one in flight.
      if (currentRequest.current) void api.ai.cancel(currentRequest.current);
      const requestId = newRequestId();
      currentRequest.current = requestId;
      setPendingCount((n) => n + 1);
      setStreaming({ requestId, question: label, text: '', startedAt: Date.now() });
      setAnnouncement('Generating answer');
      try {
        const item = await call(run(requestId));
        if (currentRequest.current !== requestId) return undefined;
        if (item) {
          setAnswers((prev) => (prev.some((p) => p.id === item.id) ? prev : [item, ...prev].slice(0, MAX_ANSWERS)));
          setActiveAnswer(item);
          setAnnouncement(`Answer ready: ${item.title}`);
        }
        return item;
      } finally {
        setPendingCount((n) => Math.max(0, n - 1));
        if (currentRequest.current === requestId) {
          currentRequest.current = null;
          setStreaming(null);
        }
      }
    },
    [call, notify],
  );

  const liveRef = useRef(liveSegments);
  liveRef.current = liveSegments;
  /** Recent transcript as explicit, user-visible context for manual questions (bounded). */
  const transcriptContext = useCallback((): string | undefined => {
    const recent = liveRef.current.filter((s) => s.isFinal).slice(-12);
    if (recent.length === 0) return undefined;
    return recent.map((s) => `${s.speaker === 'system' ? '[Other speaker]' : '[You]'}: ${s.text}`).join('\n');
  }, []);

  const ask = useCallback(
    (question: string, options: AskOptions = {}) =>
      generate(question, (requestId) => {
        const context = options.context ?? transcriptContext();
        return api!.ai.ask(question, { mode: modeRef.current, ...options, ...(context ? { context } : {}), requestId });
      }),
    [generate, transcriptContext],
  );

  const reviseAnswer = useCallback(
    async (answer: SuggestionItem, action: AnswerAction, format?: AnswerFormat) => {
      const question = answer.question || answer.title;
      const options: AskOptions = { action, answerFormat: format ?? answer.answerFormat ?? prefsRef.current.ai.answerFormat };
      if (action !== 'regenerate') options.previousAnswer = answer.content;
      if (answer.speakingTargetSec) options.speakingTargetSec = answer.speakingTargetSec;
      await ask(question, options);
    },
    [ask],
  );

  const runTool = useCallback(
    async (tool: ModeToolId, input?: string) => {
      const sessionId = snapshot.activeSession?.id ?? viewing?.summary.id;
      await generate(tool, (requestId) => api!.ai.runTool({ tool, requestId, ...(input ? { input } : {}), ...(sessionId ? { sessionId } : {}) }));
    },
    [generate, snapshot.activeSession?.id, viewing?.summary.id],
  );

  const cancel = useCallback(() => {
    const id = currentRequest.current;
    if (!id || !api) return;
    currentRequest.current = null;
    setStreaming(null);
    void api.ai.cancel(id);
    setAnnouncement('Answer cancelled');
  }, []);

  const testGemini = useCallback(async () => {
    if (!api) return undefined;
    return call(api.gemini.test());
  }, [call]);

  const saveToLibrary = useCallback(
    async (item: SaveLibraryItemRequest) => {
      if (!api) return undefined;
      const saved = await call(api.library.save(item));
      if (saved) {
        await refreshLibrary();
        setAnnouncement(`Saved to library: ${saved.title}`);
      }
      return saved;
    },
    [call, refreshLibrary],
  );

  const deleteFromLibrary = useCallback(
    async (id: string) => {
      if (!api) return;
      const done = await call(api.library.delete(id));
      if (done) {
        await refreshLibrary();
        const s = await call(api.settings.get(), true);
        if (s) setSettings(s);
        setAnnouncement('Removed from library');
      }
    },
    [call, refreshLibrary],
  );

  const savedKeys = useMemo(() => new Set(library.filter((i) => i.kind === 'answer').map((i) => i.content)), [library]);
  const isSaved = useCallback((answer: SuggestionItem) => savedKeys.has(answer.content), [savedKeys]);

  const loadScreenSources = useCallback(async () => {
    if (!api) return;
    const sources = await call(api.screen.getSources());
    if (sources) setScreenSources(sources);
  }, [call]);

  const captureScreen = useCallback(
    async (sourceId?: string) => {
      if (!api) {
        notify('info', DESKTOP_REQUIRED_ERROR);
        return;
      }
      setIsCapturingScreen(true);
      try {
        const shot = await call(api.screen.capture(sourceId ?? selectedSourceId));
        if (shot) {
          setPendingScreenshot(shot);
          setAnnouncement('Screenshot captured. Review it before it is used.');
        }
      } finally {
        setIsCapturingScreen(false);
      }
    },
    [call, notify, selectedSourceId],
  );

  const confirmScreenshot = useCallback(async () => {
    if (!api || !pendingScreenshot) return;
    const res = await call(api.screen.confirm(pendingScreenshot.id));
    if (res?.confirmed) {
      setActiveScreenshot(pendingScreenshot);
      setPendingScreenshot(null);
      setAnnouncement('Screenshot attached as context');
    }
  }, [call, pendingScreenshot]);

  const discardScreenshot = useCallback(async () => {
    if (!api) return;
    await call(api.screen.discard(pendingScreenshot?.id));
    setPendingScreenshot(null);
    setAnnouncement('Screenshot discarded');
  }, [call, pendingScreenshot]);

  const clearScreenContext = useCallback(async () => {
    if (!api) return;
    await call(api.screen.clearContext());
    setActiveScreenshot(null);
    setPendingScreenshot(null);
    setAnnouncement('Screen context removed');
  }, [call]);

  const analyzeScreen = useCallback(
    async (question: string) => {
      await generate(question, (requestId) => api!.screen.analyze({ question, mode: modeRef.current, requestId }));
    },
    [generate],
  );

  return {
    ready,
    snapshot,
    history,
    liveSegments,
    answers,
    activeAnswer,
    streaming,
    isGenerating: pendingCount > 0 && streaming !== null,
    viewing,
    notice,
    announcement,
    settings,
    prefs,
    ghost,
    windowMode,
    micDevices,
    micLabel,
    library,
    shortcut,
    start,
    stop,
    setPaused,
    view,
    closeView: useCallback(() => setViewing(null), []),
    remove,
    clearAll,
    searchHistory,
    exportSession,
    backup,
    wipeData,
    clearLiveSegments: useCallback(() => setLiveSegments([]), []),
    selectAnswer: setActiveAnswer,
    notify,
    dismissNotice: useCallback(() => setNotice(null), []),
    saveSettings,
    updatePrefs,
    setGhost,
    setWindowMode,
    testGemini,
    ask,
    reviseAnswer,
    runTool,
    cancel,
    refreshMicDevices,
    refreshLibrary,
    saveToLibrary,
    deleteFromLibrary,
    isSaved,
    screenSources,
    selectedSourceId,
    setSelectedSourceId,
    pendingScreenshot,
    activeScreenshot,
    isCapturingScreen,
    loadScreenSources,
    captureScreen,
    confirmScreenshot,
    discardScreenshot,
    clearScreenContext,
    analyzeScreen,
  };
}

function mergePrefs(base: Preferences, patch: DeepPartial<Preferences>): Preferences {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    const current = (base as unknown as Record<string, unknown>)[key];
    out[key] = value && typeof value === 'object' && current && typeof current === 'object' ? { ...current, ...value } : value;
  }
  return out as unknown as Preferences;
}
