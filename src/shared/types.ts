// Types and tiny helpers shared by main, preload and renderer.
// Keep this file free of Node/Electron/DOM imports so every process can use it.

export const SESSION_MODES = ['mock-interview', 'meeting', 'general', 'study'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export const MODE_LABELS: Record<SessionMode, string> = {
  'mock-interview': 'Mock interview',
  meeting: 'Meeting',
  general: 'General copilot',
  study: 'Study session',
};

export const SOURCE_KINDS = ['demo', 'microphone', 'system', 'both'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export type SpeakerKind = 'user' | 'system';

export type SessionStatus = 'idle' | 'starting' | 'active' | 'stopping';

export interface StartSessionRequest {
  mode: SessionMode;
  title?: string | undefined;
  source?: SourceKind | undefined;
}

export interface AudioChunkPacket {
  source: 'mic' | 'system';
  buffer: ArrayBuffer;
}

export interface SuggestionItem {
  id: string;
  sessionId: string;
  createdAt: string;
  type: 'answer_tip' | 'action_item' | 'key_point' | 'follow_up';
  title: string;
  content: string;
  source?: 'gemini' | 'heuristic' | 'test';
  isQuestion?: boolean;
  question?: string;
  formatType?: 'direct' | 'technical' | 'interview' | 'star' | 'followup' | 'meeting' | 'points' | 'code' | 'dsa';
  modelUsed?: string;
  hasVisualContext?: boolean;
  intent?: string;
  programmingLanguage?: string;
  followUpSuggestions?: string[];
  /** Presentation format the answer was generated in. */
  answerFormat?: AnswerFormat;
  /** Correlates streamed deltas / cancellation with the final item. */
  requestId?: string;
  /** Speaking-practice target the answer was sized for (seconds), if any. */
  speakingTargetSec?: number;
  action?: AnswerAction;
  tool?: ModeToolId;
}

export const ANSWER_FORMATS = ['quick', 'natural', 'structured', 'deep-dive'] as const;
export type AnswerFormat = (typeof ANSWER_FORMATS)[number];
export const ANSWER_FORMAT_LABELS: Record<AnswerFormat, string> = {
  quick: 'Quick',
  natural: 'Natural',
  structured: 'Structured',
  'deep-dive': 'Deep dive',
};

export const ANSWER_ACTIONS = ['regenerate', 'simplify', 'expand', 'example', 'rephrase'] as const;
export type AnswerAction = (typeof ANSWER_ACTIONS)[number];

/** 0 = no speaking target. */
export const SPEAKING_TARGETS = [0, 30, 60, 90] as const;

export const MODE_TOOL_IDS = [
  'interview-question',
  'evaluate-answer',
  'star-structure',
  'follow-up-questions',
  'meeting-summary',
  'decisions',
  'action-items',
  'topics',
  'explain',
  'flashcards',
  'quiz',
  'revision-notes',
  'glossary',
  'summarise',
  'key-points',
] as const;
export type ModeToolId = (typeof MODE_TOOL_IDS)[number];

export interface AskOptions {
  mode?: SessionMode;
  context?: string;
  formatType?: string;
  answerFormat?: AnswerFormat;
  speakingTargetSec?: number;
  action?: AnswerAction;
  /** Required for simplify / expand / example / rephrase. */
  previousAnswer?: string;
  requestId?: string;
  /** Attach the confirmed screenshot (default true for manual questions). */
  useScreenContext?: boolean;
}

export interface RunToolRequest {
  tool: ModeToolId;
  /** Free text the tool works on. When omitted the live/selected transcript is used. */
  input?: string;
  sessionId?: string;
  requestId?: string;
}

export interface DesktopSourceInfo {
  id: string;
  name: string;
  thumbnailUrl: string;
  displayId?: string;
  isScreen: boolean;
}

export interface ScreenshotData {
  id: string;
  sourceId: string;
  sourceName: string;
  dataUrl: string; // JPEG data URL for renderer display
  base64: string;  // Raw base64 for API transmission
  width: number;
  height: number;
  capturedAt: string; // ISO 8601
}

export interface ScreenAnalysisRequest {
  question: string;
  mode?: SessionMode;
  context?: string;
  screenshotId?: string;
}

export type GhostState = 'off' | 'applying' | 'active' | 'unsupported' | 'error';

export interface InvisibilityStatus {
  enabled: boolean;
  platform: string;
  affinityFlag: string;
  hwndHex?: string;
  lastAppliedAt: string;
  error?: string;
  /** Lifecycle state shown in the UI. Optional only for backward compatibility. */
  state?: GhostState;
  supported?: boolean;
  /** Plain-language description of what the OS mechanism does and does not do. */
  detail?: string;
}

export const THEMES = ['dark', 'light', 'high-contrast', 'system'] as const;
export type ThemeName = (typeof THEMES)[number];
export const ACCENTS = ['violet', 'blue', 'teal', 'green', 'amber', 'rose'] as const;
export type AccentName = (typeof ACCENTS)[number];

export interface AppearanceSettings {
  theme: ThemeName;
  accent: AccentName;
  /** Multiplier applied to the root font size. 0.9 – 2.0 (WCAG 1.4.4 needs 200%). */
  textScale: number;
  reducedMotion: 'system' | 'on' | 'off';
}

export interface AiSettings {
  answerFormat: AnswerFormat;
  speakingTargetSec: number;
  /** Generate answers automatically when a question is detected in the transcript. */
  autoAnswer: boolean;
  /** Also attach the confirmed screenshot to automatic answers (off = manual questions only). */
  attachScreenToAuto: boolean;
  /** Preferred Gemini model id. Empty = automatic fallback chain. */
  model: string;
  customInstructions: string;
  /** Library item (kind "profile") injected as preparation context. */
  activeProfileId: string | null;
}

export interface PrivacySettings {
  allowCloudAi: boolean;
  allowCloudScreenshots: boolean;
  allowCloudTranscription: boolean;
}

export interface ShortcutSettings {
  toggleWindow: string;
  quickAsk: string;
  captureScreen: string;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutSettings {
  expanded: boolean;
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  alwaysOnTop: boolean;
  compactBounds: WindowBounds | null;
  expandedBounds: WindowBounds | null;
  clickThrough?: boolean;
}

export interface AudioSettings {
  micDeviceId: string | null;
  defaultSource: SourceKind;
  defaultMode: SessionMode;
}

/** Non-secret preferences. Shared verbatim with the renderer. */
export interface Preferences {
  appearance: AppearanceSettings;
  ai: AiSettings;
  privacy: PrivacySettings;
  shortcuts: ShortcutSettings;
  layout: LayoutSettings;
  audio: AudioSettings;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object | null ? DeepPartial<NonNullable<T[K]>> | Extract<T[K], null> : T[K] };

export interface AppSettings {
  sttApiKey?: string;
  geminiApiKey?: string;
  sttProvider: 'deepgram' | 'google' | 'mock';
  screenShareInvisibility?: boolean;
  preferences?: Preferences;
}

/** How API keys are stored on this machine. */
export type CredentialStorage = 'os-encrypted' | 'memory-only';

/** Sanitized settings safe for renderer consumption (secrets masked). */
export interface ClientSettings {
  sttProvider: 'deepgram' | 'google' | 'mock';
  hasSttKey: boolean;
  hasGeminiKey: boolean;
  maskedSttKey?: string;
  maskedGeminiKey?: string;
  screenShareInvisibility: boolean;
  preferences: Preferences;
  credentialStorage: CredentialStorage;
}

export interface UpdateSettingsRequest {
  sttProvider?: 'deepgram' | 'google' | 'mock';
  sttApiKey?: string;
  geminiApiKey?: string;
  screenShareInvisibility?: boolean;
  preferences?: DeepPartial<Preferences>;
}

export const LIBRARY_KINDS = ['answer', 'note', 'prompt', 'profile'] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/** Locally stored saved answers, quick-capture notes, prompt templates and preparation profiles. */
export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  title: string;
  content: string;
  tags: string[];
  sessionId: string | null;
  question: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveLibraryItemRequest {
  id?: string;
  kind: LibraryKind;
  title: string;
  content: string;
  tags?: string[];
  sessionId?: string | null;
  question?: string | null;
}

export interface LibraryQuery {
  kind?: LibraryKind;
  search?: string;
  sessionId?: string;
}

export interface TranscriptSearchHit {
  sessionId: string;
  sessionTitle: string;
  startedAt: string;
  segmentId: string;
  speaker: SpeakerKind;
  startMs: number;
  text: string;
}

export type ExportFormat = 'markdown' | 'json' | 'text';

export interface ExportSessionRequest {
  sessionId: string;
  format: ExportFormat;
  includeTranscript?: boolean;
  includeAnswers?: boolean;
  includeSaved?: boolean;
}

export type ShortcutAction = 'quick-ask' | 'capture-screen';
export type WindowMode = 'compact' | 'expanded';

export interface SessionSummary {
  id: string;
  title: string;
  mode: SessionMode;
  source: SourceKind;
  startedAt: string; // ISO 8601
  endedAt: string | null;
  segmentCount: number; // finalized segments only
}

export interface TranscriptSegment {
  id: string;
  sessionId: string;
  speaker: SpeakerKind;
  startMs: number; // offset from session start
  endMs: number | null;
  text: string;
  isFinal: boolean;
}

/** What a transcript source emits; the session service attaches the sessionId. */
export type RawSegment = Omit<TranscriptSegment, 'sessionId' | 'speaker'> & {
  speaker?: SpeakerKind;
};

export interface SessionDetail {
  summary: SessionSummary;
  segments: TranscriptSegment[];
  suggestions?: SuggestionItem[];
}

export interface SessionSnapshot {
  status: SessionStatus;
  activeSession: SessionSummary | null;
  paused?: boolean;
}

export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'BUSY'
  | 'NO_ACTIVE_SESSION'
  | 'SESSION_ACTIVE'
  | 'NOT_FOUND'
  | 'SOURCE_FAILED'
  | 'UNTRUSTED_SENDER'
  | 'CANCELLED'
  | 'CONSENT_REQUIRED'
  | 'NOT_CONFIGURED'
  | 'INTERNAL';

export interface AppError {
  code: ErrorCode;
  /** Safe to show to the user: say what happened and what to do next. */
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (code: ErrorCode, message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});

export type SessionEvent =
  | { type: 'status'; snapshot: SessionSnapshot }
  | { type: 'segment'; segment: TranscriptSegment }
  | { type: 'suggestion'; suggestion: SuggestionItem }
  | { type: 'error'; error: AppError }
  /** Streaming answer text so far (accumulated, throttled). */
  | { type: 'answer-delta'; requestId: string; text: string; question?: string }
  | { type: 'ghost'; status: InvisibilityStatus }
  | { type: 'shortcut'; action: ShortcutAction }
  | { type: 'window-mode'; mode: WindowMode };
