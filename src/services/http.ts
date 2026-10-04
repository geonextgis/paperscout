/**
 * Small fetch wrapper shared by every source client: per-host rate limiting,
 * timeouts, and retries with exponential backoff that honour `Retry-After`.
 * Works in Node 20+ and in browsers.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} for ${redact(url).slice(0, 160)}${body ? ` — ${body.replace(/\s+/g, ' ').slice(0, 240)}` : ''}`);
    this.name = 'HttpError';
  }
}

/** Never let credentials passed as query parameters end up in logs. */
function redact(url: string): string {
  return url.replace(/([?&](?:api[-_]?key|key|token)=)[^&]+/gi, '$1***');
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Serializes calls so that consecutive requests are at least `minIntervalMs` apart. */
export class RateLimiter {
  private next = 0;
  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.minIntervalMs;
    if (at > now) await sleep(at - now);
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  /** JSON body for POST requests. */
  body?: unknown;
  limiter?: RateLimiter;
  /** Total attempts including the first one. */
  attempts?: number;
  timeoutMs?: number;
  /** Base delay for exponential backoff. */
  backoffMs?: number;
  onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const { headers, method = 'GET', body: payload, limiter, attempts = 4, timeoutMs = 30_000, backoffMs = 2_000, onRetry } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    await limiter?.wait();
    let waitMs = backoffMs * 2 ** (attempt - 1) + Math.random() * 500;
    try {
      const response = await fetch(url, {
        method,
        headers: payload === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return response;

      const body = await response.text().catch(() => '');
      lastError = new HttpError(response.status, url, body);
      if (!RETRYABLE.has(response.status)) throw lastError;

      const retryAfter = Number(response.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) waitMs = Math.min(retryAfter * 1000, 120_000);
    } catch (error) {
      if (error instanceof HttpError && !RETRYABLE.has(error.status)) throw error;
      lastError = error;
    }
    if (attempt < attempts) {
      onRetry?.({ attempt, waitMs, reason: lastError instanceof Error ? lastError.message : String(lastError) });
      await sleep(waitMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function getJson<T>(url: string, options?: RequestOptions): Promise<T> {
  const response = await request(url, options);
  return (await response.json()) as T;
}

export async function getText(url: string, options?: RequestOptions): Promise<string> {
  const response = await request(url, options);
  return response.text();
}
