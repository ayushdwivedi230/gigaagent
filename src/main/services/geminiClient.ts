import { logDiag } from './diagnosticsLogger';

/**
 * Single Gemini REST client (text, vision, streaming) with model fallback, bounded retry,
 * idle/overall timeouts and cancellation. Replaces the two near-identical dispatch loops that
 * previously lived in SuggestionService.
 *
 * The API key travels only in the `x-goog-api-key` header and is never logged.
 */
export const DEFAULT_GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-2.5-flash'] as const;
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export type GeminiErrorKind =
  | 'not_configured'
  | 'auth'
  | 'rate_limit'
  | 'unavailable'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'blocked'
  | 'empty'
  | 'bad_request';

export class GeminiError extends Error {
  readonly kind: GeminiErrorKind;
  readonly status: number | undefined;
  constructor(kind: GeminiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind;
    this.status = status;
  }
  /** Worth trying the next model in the chain. */
  get retryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'unavailable' || (this.kind === 'bad_request' && this.status === 404);
  }
}

/** Message that is safe and useful to show to the user. Never contains response bodies or keys. */
export function describeGeminiError(error: unknown): string {
  const kind = error instanceof GeminiError ? error.kind : 'network';
  switch (kind) {
    case 'not_configured':
      return 'No Gemini API key is configured. Add one in Settings → AI.';
    case 'auth':
      return 'Gemini rejected the API key. Check the key in Settings → AI.';
    case 'rate_limit':
      return 'Gemini is rate-limiting this key. Wait a moment, then retry.';
    case 'unavailable':
      return 'Gemini is temporarily unavailable. Retry in a moment.';
    case 'timeout':
      return 'Gemini took too long to respond. Check your connection and retry.';
    case 'cancelled':
      return 'The answer was cancelled.';
    case 'blocked':
      return 'Gemini declined to answer this request (safety filter).';
    case 'empty':
      return 'Gemini returned an empty answer. Retry, or rephrase the question.';
    case 'bad_request':
      return 'Gemini could not process this request. Try a different model in Settings → AI.';
    default:
      return 'Could not reach Gemini. Check your internet connection and retry.';
  }
}

export interface GeminiRequest {
  prompt: string;
  imageBase64?: string | undefined;
  signal?: AbortSignal | undefined;
  /** When provided the request streams; called with the accumulated text so far. */
  onDelta?: ((accumulated: string) => void) | undefined;
  json?: boolean | undefined;
  maxOutputTokens?: number | undefined;
  temperature?: number | undefined;
  preferredModel?: string | undefined;
}

export interface GeminiResult {
  text: string;
  modelUsed: string;
  latencyMs: number;
  /** Token counts when the API reports them. */
  usage?: { promptTokens: number; outputTokens: number } | undefined;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Response>;

export interface GeminiClientOptions {
  getApiKey: () => string | undefined;
  fetchImpl?: FetchLike;
  models?: readonly string[];
  /** Abort if nothing at all arrives within this window. */
  timeoutMs?: number;
  /** Abort a stream that stalls between chunks. */
  idleTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface Part {
  text?: string;
}
interface Chunk {
  candidates?: Array<{ content?: { parts?: Part[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

const textOf = (chunk: Chunk): string => (chunk.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');

export class GeminiClient {
  private readonly getApiKey: () => string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly models: readonly string[];
  private readonly timeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly active = new Set<AbortController>();

  constructor(options: GeminiClientOptions) {
    this.getApiKey = options.getApiKey;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.models = options.models ?? DEFAULT_GEMINI_MODELS;
    this.timeoutMs = options.timeoutMs ?? 25_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 12_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get inFlight(): number {
    return this.active.size;
  }

  abortAll(): number {
    const count = this.active.size;
    for (const c of [...this.active]) c.abort(new GeminiError('cancelled', 'Request cancelled.'));
    this.active.clear();
    return count;
  }

  modelChain(preferred?: string): string[] {
    const chain = preferred ? [preferred, ...this.models] : [...this.models];
    return [...new Set(chain.filter(Boolean))];
  }

  async generate(request: GeminiRequest): Promise<GeminiResult> {
    const apiKey = this.getApiKey()?.trim();
    if (!apiKey) throw new GeminiError('not_configured', 'No Gemini API key is configured.');

    const chain = this.modelChain(request.preferredModel);
    let lastError: GeminiError = new GeminiError('unavailable', 'No Gemini model is available.');

    for (let i = 0; i < chain.length; i++) {
      const model = chain[i]!;
      if (request.signal?.aborted) throw new GeminiError('cancelled', 'Request cancelled.');
      try {
        return await this.attempt(apiKey, model, request);
      } catch (cause) {
        const error = cause instanceof GeminiError ? cause : new GeminiError('network', cause instanceof Error ? cause.message : String(cause));
        lastError = error;
        logDiag('AIDiag:Model', 'Gemini attempt failed', { model, kind: error.kind, status: error.status });
        if (!error.retryable || i === chain.length - 1) throw error;
        // Bounded backoff before moving to the next model: 400ms, 800ms, 1200ms…
        if (error.kind !== 'bad_request') await this.sleep(Math.min(2000, 400 * (i + 1)));
      }
    }
    throw lastError;
  }

  private async attempt(apiKey: string, model: string, request: GeminiRequest): Promise<GeminiResult> {
    const controller = new AbortController();
    this.active.add(controller);
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = (ms: number): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new GeminiError('timeout', `Gemini timed out after ${ms}ms.`)), ms);
    };
    const onOuterAbort = (): void => controller.abort(new GeminiError('cancelled', 'Request cancelled.'));
    request.signal?.addEventListener('abort', onOuterAbort, { once: true });
    arm(this.timeoutMs);

    try {
      const streaming = Boolean(request.onDelta);
      const parts: Array<Record<string, unknown>> = [];
      if (request.imageBase64) parts.push({ inlineData: { mimeType: 'image/jpeg', data: request.imageBase64 } });
      parts.push({ text: request.prompt });
      const generationConfig: Record<string, unknown> = {
        temperature: request.temperature ?? 0.3,
        maxOutputTokens: request.maxOutputTokens ?? 2048,
      };
      if (request.json) generationConfig.responseMimeType = 'application/json';

      const url = `${ENDPOINT}/${encodeURIComponent(model)}:${streaming ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ contents: [{ parts }], generationConfig }),
        });
      } catch (cause) {
        throw this.fromAbort(controller, cause);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw classifyHttp(response.status, body);
      }

      let text = '';
      let usage: GeminiResult['usage'];
      let blocked: string | undefined;
      const absorb = (chunk: Chunk): void => {
        if (chunk.promptFeedback?.blockReason) blocked = chunk.promptFeedback.blockReason;
        if (chunk.candidates?.[0]?.finishReason === 'SAFETY') blocked = 'SAFETY';
        if (chunk.usageMetadata) {
          usage = { promptTokens: chunk.usageMetadata.promptTokenCount ?? 0, outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0 };
        }
        text += textOf(chunk);
      };

      if (streaming && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          for (;;) {
            arm(this.idleTimeoutMs);
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, nl).replace(/\r$/, '');
              buffer = buffer.slice(nl + 1);
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;
              try {
                const before = text.length;
                absorb(JSON.parse(payload) as Chunk);
                if (text.length > before) request.onDelta?.(text);
              } catch {
                // A malformed SSE frame is skipped; the final text check below still applies.
              }
            }
          }
        } catch (cause) {
          throw this.fromAbort(controller, cause);
        }
      } else {
        try {
          absorb((await response.json()) as Chunk);
        } catch (cause) {
          throw this.fromAbort(controller, cause);
        }
      }

      if (!text.trim()) {
        if (blocked) throw new GeminiError('blocked', `Gemini blocked the response (${blocked}).`);
        throw new GeminiError('empty', `Gemini returned no text for ${model}.`);
      }
      return { text, modelUsed: model, latencyMs: Date.now() - startedAt, usage };
    } finally {
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener('abort', onOuterAbort);
      this.active.delete(controller);
    }
  }

  private fromAbort(controller: AbortController, cause: unknown): GeminiError {
    if (cause instanceof GeminiError) return cause;
    if (controller.signal.aborted) {
      const reason: unknown = controller.signal.reason;
      return reason instanceof GeminiError ? reason : new GeminiError('cancelled', 'Request cancelled.');
    }
    return new GeminiError('network', cause instanceof Error ? cause.message : String(cause));
  }
}

export function classifyHttp(status: number, body: string): GeminiError {
  const hint = body.slice(0, 160).replace(/\s+/g, ' ');
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(body)) {
    return new GeminiError('auth', `Gemini HTTP ${status}: authentication failed.`, status);
  }
  if (status === 429) return new GeminiError('rate_limit', `Gemini HTTP 429: ${hint}`, status);
  if (status === 404) return new GeminiError('bad_request', `Gemini HTTP 404: model not found.`, status);
  if (status >= 500) return new GeminiError('unavailable', `Gemini HTTP ${status}: ${hint}`, status);
  return new GeminiError('bad_request', `Gemini HTTP ${status}: ${hint}`, status);
}
