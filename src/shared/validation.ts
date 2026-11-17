import { ANSWER_ACTIONS, ANSWER_FORMATS, err, LIBRARY_KINDS, MODE_TOOL_IDS, ok, SESSION_MODES, SOURCE_KINDS, SPEAKING_TARGETS } from './types';
import type {
  AskOptions,
  ExportSessionRequest,
  LibraryQuery,
  Result,
  RunToolRequest,
  SaveLibraryItemRequest,
  SessionMode,
  SourceKind,
  StartSessionRequest,
} from './types';

export const MAX_TITLE_LENGTH = 120;
const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** IPC input is untrusted: validate shape and bounds before it reaches any service. */
export function parseStartRequest(input: unknown): Result<StartSessionRequest> {
  if (typeof input !== 'object' || input === null) {
    return err('INVALID_REQUEST', 'The start request was malformed.');
  }
  const { mode, title, source } = input as Record<string, unknown>;
  if (typeof mode !== 'string' || !(SESSION_MODES as readonly string[]).includes(mode)) {
    return err('INVALID_REQUEST', 'Choose a session type: mock interview, meeting, or study session.');
  }
  if (source !== undefined && (typeof source !== 'string' || !(SOURCE_KINDS as readonly string[]).includes(source))) {
    return err('INVALID_REQUEST', 'Invalid audio source selected.');
  }
  let cleanTitle: string | undefined;
  if (title !== undefined) {
    if (typeof title !== 'string') return err('INVALID_REQUEST', 'The session name must be text.');
    const collapsed = title.trim().replace(/\s+/g, ' ');
    if (collapsed.length > MAX_TITLE_LENGTH) {
      return err('INVALID_REQUEST', `Session names can be up to ${MAX_TITLE_LENGTH} characters.`);
    }
    cleanTitle = collapsed || undefined;
  }
  const result: StartSessionRequest = { mode: mode as SessionMode };
  if (cleanTitle !== undefined) result.title = cleanTitle;
  if (source !== undefined) result.source = source as SourceKind;
  return ok(result);
}

export function parseSessionId(input: unknown): Result<string> {
  if (typeof input !== 'string' || !ID_PATTERN.test(input)) {
    return err('INVALID_REQUEST', 'The session id was malformed.');
  }
  return ok(input);
}

// ─────────────────────────────── GigaAgent 3.0 additions ───────────────────────────────

export const MAX_QUESTION_LENGTH = 4000;
export const MAX_CONTEXT_LENGTH = 24_000;
export const MAX_LIBRARY_TITLE = 160;
export const MAX_LIBRARY_CONTENT = 60_000;
export const MAX_TAGS = 12;
export const MAX_AUDIO_CHUNK_BYTES = 256 * 1024;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inList = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

export function parseRequestId(input: unknown): Result<string> {
  return typeof input === 'string' && REQUEST_ID.test(input) ? ok(input) : err('INVALID_REQUEST', 'The request id was malformed.');
}

export function parseQuestion(input: unknown): Result<string> {
  if (typeof input !== 'string') return err('INVALID_REQUEST', 'The question must be text.');
  const q = input.trim();
  if (!q) return err('INVALID_REQUEST', 'Question cannot be empty.');
  if (q.length > MAX_QUESTION_LENGTH) return err('INVALID_REQUEST', `Questions can be up to ${MAX_QUESTION_LENGTH} characters.`);
  return ok(q);
}

/** Drops unknown keys and out-of-range values instead of failing: options are optional refinements. */
export function parseAskOptions(input: unknown): AskOptions {
  if (!isRecord(input)) return {};
  const out: AskOptions = {};
  if (inList(input.mode, SESSION_MODES)) out.mode = input.mode;
  if (typeof input.context === 'string') out.context = input.context.slice(-MAX_CONTEXT_LENGTH);
  if (typeof input.formatType === 'string') out.formatType = input.formatType.slice(0, 40);
  if (inList(input.answerFormat, ANSWER_FORMATS)) out.answerFormat = input.answerFormat;
  if ((SPEAKING_TARGETS as readonly unknown[]).includes(input.speakingTargetSec)) out.speakingTargetSec = input.speakingTargetSec as number;
  if (inList(input.action, ANSWER_ACTIONS)) out.action = input.action;
  if (typeof input.previousAnswer === 'string') out.previousAnswer = input.previousAnswer.slice(0, MAX_CONTEXT_LENGTH);
  if (typeof input.requestId === 'string' && REQUEST_ID.test(input.requestId)) out.requestId = input.requestId;
  if (typeof input.useScreenContext === 'boolean') out.useScreenContext = input.useScreenContext;
  return out;
}

export function parseRunTool(input: unknown): Result<RunToolRequest> {
  if (!isRecord(input) || !inList(input.tool, MODE_TOOL_IDS)) return err('INVALID_REQUEST', 'Unknown tool.');
  const out: RunToolRequest = { tool: input.tool };
  if (typeof input.input === 'string' && input.input.trim()) out.input = input.input.trim().slice(0, MAX_CONTEXT_LENGTH);
  if (typeof input.sessionId === 'string' && ID_PATTERN.test(input.sessionId)) out.sessionId = input.sessionId;
  if (typeof input.requestId === 'string' && REQUEST_ID.test(input.requestId)) out.requestId = input.requestId;
  return ok(out);
}

export function parseLibrarySave(input: unknown): Result<SaveLibraryItemRequest> {
  if (!isRecord(input)) return err('INVALID_REQUEST', 'The item was malformed.');
  if (!inList(input.kind, LIBRARY_KINDS)) return err('INVALID_REQUEST', 'Unknown library item type.');
  if (typeof input.content !== 'string' || !input.content.trim()) return err('INVALID_REQUEST', 'There is nothing to save.');
  if (input.content.length > MAX_LIBRARY_CONTENT) return err('INVALID_REQUEST', 'That item is too large to save.');
  const rawTitle = typeof input.title === 'string' ? input.title.trim().replace(/\s+/g, ' ') : '';
  const title = (rawTitle || input.content.trim().split('\n')[0] || 'Untitled').slice(0, MAX_LIBRARY_TITLE);
  const out: SaveLibraryItemRequest = { kind: input.kind, title, content: input.content };
  if (input.id !== undefined) {
    if (typeof input.id !== 'string' || !ID_PATTERN.test(input.id)) return err('INVALID_REQUEST', 'The item id was malformed.');
    out.id = input.id;
  }
  if (Array.isArray(input.tags)) {
    out.tags = [...new Set(input.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase().slice(0, 32)).filter(Boolean))].slice(0, MAX_TAGS);
  }
  if (input.sessionId === null || (typeof input.sessionId === 'string' && ID_PATTERN.test(input.sessionId))) out.sessionId = input.sessionId;
  if (input.question === null || typeof input.question === 'string') out.question = input.question === null ? null : input.question.slice(0, MAX_QUESTION_LENGTH);
  return ok(out);
}

export function parseLibraryQuery(input: unknown): LibraryQuery {
  if (!isRecord(input)) return {};
  const out: LibraryQuery = {};
  if (inList(input.kind, LIBRARY_KINDS)) out.kind = input.kind;
  if (typeof input.search === 'string' && input.search.trim()) out.search = input.search.trim().slice(0, 200);
  if (typeof input.sessionId === 'string' && ID_PATTERN.test(input.sessionId)) out.sessionId = input.sessionId;
  return out;
}

export function parseSearchQuery(input: unknown): Result<string> {
  if (typeof input !== 'string') return err('INVALID_REQUEST', 'The search text was malformed.');
  const q = input.trim().slice(0, 200);
  return q.length >= 2 ? ok(q) : err('INVALID_REQUEST', 'Type at least two characters to search.');
}

export function parseExportRequest(input: unknown): Result<ExportSessionRequest> {
  if (!isRecord(input)) return err('INVALID_REQUEST', 'The export request was malformed.');
  const id = parseSessionId(input.sessionId);
  if (!id.ok) return id;
  if (!inList(input.format, ['markdown', 'json', 'text'] as const)) return err('INVALID_REQUEST', 'Unsupported export format.');
  const out: ExportSessionRequest = { sessionId: id.value, format: input.format };
  for (const key of ['includeTranscript', 'includeAnswers', 'includeSaved'] as const) {
    if (typeof input[key] === 'boolean') out[key] = input[key];
  }
  return ok(out);
}

/** Escapes LIKE wildcards so user search text is always matched literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
