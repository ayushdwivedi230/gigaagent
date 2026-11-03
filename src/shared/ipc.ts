import type {
  ClientSettings,
  Result,
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
  event: 'session:event',
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',
} as const;

/** The only surface the renderer can use to reach the main process (exposed as window.api). */
export interface MeetingAssistantApi {
  session: {
    start(request: StartSessionRequest): Promise<Result<SessionSnapshot>>;
    stop(): Promise<Result<SessionSummary>>;
    snapshot(): Promise<Result<SessionSnapshot>>;
  };
  history: {
    list(): Promise<Result<SessionSummary[]>>;
    get(id: string): Promise<Result<SessionDetail>>;
    delete(id: string): Promise<Result<{ deleted: number }>>;
    clear(): Promise<Result<{ deleted: number }>>;
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
  /** Frameless window controls. */
  window: {
    minimize(): void;
    close(): void;
  };
  /** Subscribe to main-process events. Returns an unsubscribe function. */
  onEvent(listener: (event: SessionEvent) => void): () => void;
}
