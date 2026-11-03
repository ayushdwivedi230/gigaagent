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
  formatType?: 'direct' | 'technical' | 'interview' | 'star' | 'followup' | 'meeting' | 'points';
  modelUsed?: string;
}

export interface AppSettings {
  sttApiKey?: string;
  geminiApiKey?: string;
  sttProvider: 'deepgram' | 'google' | 'mock';
}

/** Sanitized settings safe for renderer consumption (secrets masked). */
export interface ClientSettings {
  sttProvider: 'deepgram' | 'google' | 'mock';
  hasSttKey: boolean;
  hasGeminiKey: boolean;
  maskedSttKey?: string;
  maskedGeminiKey?: string;
}

export interface UpdateSettingsRequest {
  sttProvider?: 'deepgram' | 'google' | 'mock';
  sttApiKey?: string;
  geminiApiKey?: string;
}

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
}

export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'BUSY'
  | 'NO_ACTIVE_SESSION'
  | 'SESSION_ACTIVE'
  | 'NOT_FOUND'
  | 'SOURCE_FAILED'
  | 'UNTRUSTED_SENDER'
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
  | { type: 'error'; error: AppError };
