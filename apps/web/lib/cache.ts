/**
 * Tiny TTL cache. Uses Upstash Redis when configured (shared across instances),
 * else an in-process Map with per-key expiry. No new dependency — reuses the
 * @upstash/redis client already in the project (see lib/rate-limit.ts).
 *
 * Values are JSON-serialized. Intended for cheap, public, read-mostly payloads
 * (the public posts API + RSS feed) where a few minutes of staleness is fine.
 * Never cache anything user-specific or payment-related here.
 */
import { Redis } from "@upstash/redis";

const hasUpstash = !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = hasUpstash ? Redis.fromEnv() : null;

// In-process fallback: value + absolute expiry (ms). Per-process only — fine for
// a single instance; multi-instance deployments should set UPSTASH_REDIS_*.
const mem = new Map<string, { value: string; expiresAt: number }>();

/** Read a cached value, or null on miss/expiry. Never throws. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    if (redis) {
      const raw = await redis.get<string>(key);
      return raw ? (JSON.parse(raw) as T) : null;
    }
    const hit = mem.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      mem.delete(key);
      return null;
    }
    return JSON.parse(hit.value) as T;
  } catch {
    return null; // a cache miss must never break the request
  }
}

/** Store a value with a TTL in seconds. Best-effort; never throws. */
export async function cacheSet<T>(key: string, value: T, ttlSec: number): Promise<void> {
  try {
    const raw = JSON.stringify(value);
    if (redis) {
      await redis.set(key, raw, { ex: ttlSec });
      return;
    }
    // Opportunistic sweep so the Map can't grow unbounded.
    if (mem.size > 500) {
      const now = Date.now();
      for (const [k, v] of mem) if (v.expiresAt <= now) mem.delete(k);
    }
    mem.set(key, { value: raw, expiresAt: Date.now() + ttlSec * 1000 });
  } catch {
    /* best-effort cache write */
  }
}
