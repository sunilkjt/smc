/**
 * Hyperliquid public API (`/info`) client.
 *
 * Requirements implemented here:
 * - Bounded concurrency (max 3 in-flight requests) to respect the 1200
 *   weight/minute/IP budget on shared networks.
 * - Timeout per request (default 15s) via AbortController.
 * - Retry with exponential backoff + jitter on transient failures
 *   (network errors, timeouts, HTTP 429, HTTP 5xx). Honors `Retry-After`.
 * - Response-shape validation before any processing: a validator predicate
 *   must accept the payload or a non-transient `invalid-response` error is
 *   thrown. Network errors are NEVER converted into empty successful results.
 * - Works in browsers (Vite) and Node (tsx scripts). No secrets, no signing.
 */

export const DEFAULT_HL_API_BASE = 'https://api.hyperliquid.xyz';

export type HyperliquidErrorKind =
  | 'network'
  | 'timeout'
  | 'http'
  | 'rate-limited'
  | 'invalid-response';

export class HyperliquidError extends Error {
  readonly kind: HyperliquidErrorKind;
  readonly status?: number;
  /** Hint in ms for how long to wait before retrying (from `Retry-After`). */
  readonly retryAfterMs?: number;
  /** True when retrying may help (network/timeout/429/5xx). */
  readonly transient: boolean;

  constructor(
    kind: HyperliquidErrorKind,
    message: string,
    opts?: { status?: number; transient?: boolean; retryAfterMs?: number },
  ) {
    super(message);
    this.name = 'HyperliquidError';
    this.kind = kind;
    this.status = opts?.status;
    this.retryAfterMs = opts?.retryAfterMs;
    this.transient =
      opts?.transient ?? (kind === 'network' || kind === 'timeout' || kind === 'rate-limited');
  }
}

export interface PostInfoOptions {
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
}

function readEnv(name: string): string | undefined {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process;
    const fromNode = proc?.env?.[name];
    if (fromNode) return fromNode;
  } catch {
    /* ignore */
  }
  try {
    const meta = import.meta as unknown as {
      env?: Record<string, string | undefined>;
    };
    return meta.env?.[name];
  } catch {
    return undefined;
  }
}

/** API base override for testing; defaults to mainnet public API. */
export function resolveApiBase(): string {
  const override = readEnv('VITE_HL_API_BASE') ?? readEnv('HL_API_BASE');
  return (override ?? DEFAULT_HL_API_BASE).replace(/\/+$/, '');
}

/** Tiny semaphore bounding concurrent API requests. */
export class Semaphore {
  private running = 0;
  private readonly queue: Array<() => void> = [];
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  async acquire(): Promise<() => void> {
    if (this.running < this.max) {
      this.running += 1;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.running += 1;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.running -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

/** Shared process-wide limiter: at most 3 concurrent `/info` requests. */
export const apiSemaphore = new Semaphore(3);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, baseDelayMs: number, retryAfterMs?: number): number {
  const expo = baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * Math.min(500, baseDelayMs));
  const delay = expo + jitter;
  return retryAfterMs != null ? Math.max(delay, retryAfterMs) : delay;
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

/**
 * POST a JSON body to the Hyperliquid `/info` endpoint and return the parsed
 * JSON payload. Throws `HyperliquidError` on failure; never returns a
 * fallback value.
 */
export async function postInfo<T>(
  body: unknown,
  validate: (value: unknown) => value is T,
  opts?: PostInfoOptions,
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? 15000;
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;
  const url = `${resolveApiBase()}/info`;
  const payload = JSON.stringify(body);

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const release = await apiSemaphore.acquire();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new HyperliquidError('timeout', `Request timed out after ${timeoutMs}ms`);
        }
        throw new HyperliquidError(
          'network',
          `Network error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 429) {
        throw new HyperliquidError('rate-limited', 'Rate limited (HTTP 429)', {
          status: 429,
          retryAfterMs: parseRetryAfterMs(response.headers.get('Retry-After')),
        });
      }
      if (response.status >= 500) {
        throw new HyperliquidError('http', `Server error (HTTP ${response.status})`, {
          status: response.status,
          transient: true,
        });
      }
      if (!response.ok) {
        throw new HyperliquidError('http', `Request failed (HTTP ${response.status})`, {
          status: response.status,
        });
      }

      let parsed: unknown;
      try {
        parsed = (await response.json()) as unknown;
      } catch {
        throw new HyperliquidError('invalid-response', 'Response was not valid JSON');
      }
      if (!validate(parsed)) {
        throw new HyperliquidError(
          'invalid-response',
          'Response shape did not match the expected schema',
        );
      }
      void lastError;
      return parsed;
    } catch (err) {
      lastError = err;
      const transient = err instanceof HyperliquidError ? err.transient : false;
      const isLast = attempt >= maxRetries;
      if (!transient || isLast) throw err;
      const retryAfterMs = err instanceof HyperliquidError ? err.retryAfterMs : undefined;
      await sleep(backoffDelay(attempt, baseDelayMs, retryAfterMs));
    } finally {
      release();
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new HyperliquidError('network', 'Request failed');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
