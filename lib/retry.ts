/**
 * Tiny retry helper for enrichment fetches.
 *
 * Retries transient failures (network, timeouts, 5xx) with exponential
 * backoff. Skips retries on 4xx responses since those are caller/auth
 * issues and won't recover by waiting.
 */

const FOUR_XX_RE = /\b(4\d{2})\b/;

const FIVE_XX_RE = /\b(5\d{2})\b/;

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isRetryable = (err: unknown): boolean => {
  const msg = (err as Error)?.message ?? "";
  if (FIVE_XX_RE.test(msg)) return true;
  // 4xx responses are caller/auth issues and won't recover.
  if (FOUR_XX_RE.test(msg)) return false;
  // Otherwise assume network/timeout/abort and retry.
  return true;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const maxDelayMs = opts.maxDelayMs ?? 2_000;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetryable(err)) break;
      const delay = Math.min(baseDelayMs * 2 ** i, maxDelayMs);
      await sleep(delay);
    }
  }
  throw lastErr;
}
