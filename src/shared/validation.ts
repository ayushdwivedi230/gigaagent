import { err, ok, SESSION_MODES } from './types';
import type { Result, SessionMode, StartSessionRequest } from './types';

export const MAX_TITLE_LENGTH = 120;
const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** IPC input is untrusted: validate shape and bounds before it reaches any service. */
export function parseStartRequest(input: unknown): Result<StartSessionRequest> {
  if (typeof input !== 'object' || input === null) {
    return err('INVALID_REQUEST', 'The start request was malformed.');
  }
  const { mode, title } = input as Record<string, unknown>;
  if (typeof mode !== 'string' || !(SESSION_MODES as readonly string[]).includes(mode)) {
    return err('INVALID_REQUEST', 'Choose a session type: mock interview, meeting, or study session.');
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
  return ok({ mode: mode as SessionMode, title: cleanTitle });
}

export function parseSessionId(input: unknown): Result<string> {
  if (typeof input !== 'string' || !ID_PATTERN.test(input)) {
    return err('INVALID_REQUEST', 'The session id was malformed.');
  }
  return ok(input);
}
