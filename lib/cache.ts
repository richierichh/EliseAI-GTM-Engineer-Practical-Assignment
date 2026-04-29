/**
 * Tiny in-memory TTL cache used to avoid burning rate-limited API quotas
 * (e.g. NewsAPI free tier = 100 req/day) when the same lead is enriched
 * multiple times during a demo / dev session.
 *
 * Lifetime is per Node process, so it works for `next dev` and a single
 * Vercel serverless instance. For multi-instance production traffic this
 * should be swapped for Redis / Vercel KV.
 */

type Entry<T> = { value: T; expiresAt: number };

const stores = new Map<string, Map<string, Entry<unknown>>>();

const getStore = (namespace: string): Map<string, Entry<unknown>> => {
  let s = stores.get(namespace);
  if (!s) {
    s = new Map();
    stores.set(namespace, s);
  }
  return s;
};

export function cacheGet<T>(namespace: string, key: string): T | undefined {
  const s = getStore(namespace);
  const entry = s.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    s.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(
  namespace: string,
  key: string,
  value: T,
  ttlMs: number
): void {
  const s = getStore(namespace);
  s.set(key, { value, expiresAt: Date.now() + ttlMs });
}
