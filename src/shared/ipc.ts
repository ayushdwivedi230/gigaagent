import type {
  AskOptions,
  ClientSettings,
  ExportSessionRequest,
  LibraryItem,
  LibraryQuery,
  RunToolRequest,
  SaveLibraryItemRequest,
  TranscriptSearchHit,
  WindowMode,
  DesktopSourceInfo,
  InvisibilityStatus,
  Result,
  ScreenAnalysisRequest,
  ScreenshotData,
  SessionDetail,
  SessionEvent,
  SessionSnapshot,
  SessionSummary,
  StartSessionRequest,
  SuggestionItem,
  UpdateSettingsRequest,
} from './types';

/** Channel names. Only runtime export of this module so the sandboxed preload stays tiny. */
export const IPC = {
  sessionStart: 'session:start',
  sessionStop: 'session:stop',
  sessionSnapshot: 'session:snapshot',
  historyList: 'history:list',
  historyGet: 'history:get',
  historyDelete: 'history:delete',
  historyClear: 'history:clear',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  systemAudioArm: 'system-audio:arm',
  systemAudioDisarm: 'system-audio:disarm',
  audioChunk: 'audio:chunk',
  geminiTest: 'gemini:test',
  aiAsk: 'ai:ask',
  screenGetSources: 'screen:get-sources',
  screenCapture: 'screen:capture',
  screenConfirm: 'screen:confirm',
  screenDiscard: 'screen:discard',
  screenClearContext: 'screen:clear-context',
  screenGetContext: 'screen:get-context',
  screenAnalyze: 'screen:analyze',
  diagnosticsGet: 'diagnostics:get',
  diagnosticsExport: 'diagnostics:export',
  diagLog: 'diag:log',
  event: 'session:event',
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',
  invisibilityGet: 'invisibility:get',
  invisibilitySet: 'invisibility:set',
  aiCancel: 'ai:cancel',
  aiRunTool: 'ai:run-tool',
  libraryList: 'library:list',
  librarySave: 'library:save',
  libraryDelete: 'library:delete',
  libraryClear: 'library:clear',
  historySearch: 'history:search',
  exportSession: 'export:session',
  exportBackup: 'export:backup',
  dataWipe: 'data:wipe',
  windowSetMode: 'window:set-mode',
  windowSetAlwaysOnTop: 'window:set-always-on-top',
  windowSetIgnoreMouseEvents: 'window:set-ignore-mouse-events',
  sessionPause: 'session:pause',
} as const;

/** The only surface the renderer can use to reach the main process (exposed as window.api). */
export interface MeetingAssistantApi {
  session: {
    start(request: StartSessionRequest): Promise<Result<SessionSnapshot>>;
    stop(): Promise<Result<SessionSummary>>;
    snapshot(): Promise<Result<SessionSnapshot>>;
    /** Pauses/resumes automatic answers and transcript intake for the running session. */
    setPaused(paused: boolean): Promise<Result<{ paused: boolean }>>;
  };
  history: {
    list(): Promise<Result<SessionSummary[]>>;
    get(id: string): Promise<Result<SessionDetail>>;
    delete(id: string): Promise<Result<{ deleted: number }>>;
    clear(): Promise<Result<{ deleted: number }>>;
    search(query: string): Promise<Result<TranscriptSearchHit[]>>;
  };
  settings: {
    get(): Promise<Result<ClientSettings>>;
    save(settings: UpdateSettingsRequest): Promise<Result<ClientSettings>>;
  };
  systemAudio: {
    arm(): Promise<Result<{ armed: boolean }>>;
    disarm(): Promise<Result<{ armed: boolean }>>;
  };
  audio: {
    sendChunk(source: 'mic' | 'system', buffer: ArrayBuffer): void;
  };
  gemini: {
    test(question?: string): Promise<Result<SuggestionItem>>;
  };
  ai: {
    ask(question: string, options?: AskOptions): Promise<Result<SuggestionItem>>;
    /** Cancels an in-flight answer. Without an id, cancels everything in flight. */
    cancel(requestId?: string): Promise<Result<{ cancelled: number }>>;
    /** Runs a mode tool (summary, flashcards, answer evaluation…) over text or the session transcript. */
    runTool(request: RunToolRequest): Promise<Result<SuggestionItem>>;
  };
  library: {
    list(query?: LibraryQuery): Promise<Result<LibraryItem[]>>;
    save(item: SaveLibraryItemRequest): Promise<Result<LibraryItem>>;
    delete(id: string): Promise<Result<{ deleted: number }>>;
    clear(): Promise<Result<{ deleted: number }>>;
  };
  data: {
    /** Asks where to save, then writes the export. `saved: false` means the user cancelled. */
    exportSession(request: ExportSessionRequest): Promise<Result<{ saved: boolean; path?: string }>>;
    /** Copies the local database to a user-chosen file. */
    backup(): Promise<Result<{ saved: boolean; path?: string }>>;
    /** Deletes every session, saved item and screenshot context. API keys and preferences are kept. */
    wipe(): Promise<Result<{ sessions: number; libraryItems: number }>>;
  };
  screen: {
    getSources(): Promise<Result<DesktopSourceInfo[]>>;
    capture(sourceId?: string): Promise<Result<ScreenshotData>>;
    confirm(screenshotId: string): Promise<Result<{ confirmed: boolean }>>;
    discard(screenshotId?: string): Promise<Result<{ discarded: boolean }>>;
    clearContext(): Promise<Result<{ cleared: boolean }>>;
    getContext(): Promise<Result<ScreenshotData | null>>;
    analyze(request: ScreenAnalysisRequest & { requestId?: string }): Promise<Result<SuggestionItem>>;
  };
  diagnostics: {
    get(): Promise<Result<import('./errorTypes').DiagnosticsSnapshot>>;
    export(): Promise<Result<{ exportedPath: string; content: string }>>;
  };
  diag: {
    log(category: string, message: string, data?: Record<string, unknown>): void;
  };
  /** Frameless window controls. */
  window: {
    minimize(): void;
    close(): void;
    setMode(mode: WindowMode): Promise<Result<{ mode: WindowMode }>>;
    setAlwaysOnTop(value: boolean): Promise<Result<{ alwaysOnTop: boolean }>>;
    setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): Promise<Result<{ ignore: boolean; forward?: boolean }>>;
  };
  /** Screen-share invisibility & window capture exclusion controls. */
  invisibility: {
    getStatus(): Promise<Result<InvisibilityStatus>>;
    setEnabled(enabled: boolean): Promise<Result<InvisibilityStatus>>;
  };
  /** Subscribe to main-process events. Returns an unsubscribe function. */
  onEvent(listener: (event: SessionEvent) => void): () => void;
}
