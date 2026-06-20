/**
 * Rate limiting. Upstash Redis (sliding window) when configured, else an
 * in-memory sliding-window fallback with a one-time startup warning.
 *
 * Call this at the TOP of a route handler, before any business logic:
 *
 *   const rl = await rateLimit({ key: `import:${ip}`, limit: 10, windowSec: 60 });
 *   if (!rl.ok) return rateLimitResponse(rl);
 *
 * The in-memory store is per-process — fine for a single instance, NOT for
 * multi-instance/serverless; production should set UPSTASH_REDIS_REST_URL.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface RateResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Unix seconds when the window resets. */
  reset: number;
  /** Seconds until the caller may retry. */
  retryAfter: number;
}

const hasUpstash = !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

let warned = false;
function warnInMemory(): void {
  if (warned) return;
  warned = true;
  console.warn(
    "⚠️ No Redis configured — using in-memory rate limiting. Not suitable for multi-instance deployments."
  );
}

// ── Upstash limiters (one per limit/window combo, lazily created) ─────────────
const redis = hasUpstash ? Redis.fromEnv() : null;
const limiters = new Map<string, Ratelimit>();
function upstashLimiter(limit: number, windowSec: number): Ratelimit {
  const key = `${limit}:${windowSec}`;
  let rl = limiters.get(key);
  if (!rl) {
    rl = new Ratelimit({
      redis: redis!,
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      prefix: "skimflow:rl",
      analytics: false,
    });
    limiters.set(key, rl);
  }
  return rl;
}

// ── In-memory sliding window log ──────────────────────────────────────────────
const memory = new Map<string, number[]>();
function memoryLimit(key: string, limit: number, windowSec: number): RateResult {
  warnInMemory();
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const hits = (memory.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    const reset = Math.ceil((hits[0] + windowMs) / 1000);
    memory.set(key, hits);
    return { ok: false, limit, remaining: 0, reset, retryAfter: Math.max(1, reset - Math.ceil(now / 1000)) };
  }
  hits.push(now);
  memory.set(key, hits);
  // Opportunistic cleanup to bound memory growth.
  if (memory.size > 10_000) {
    for (const [k, v] of memory) {
      if (v.every((t) => now - t >= windowMs)) memory.delete(k);
    }
  }
  return {
    ok: true,
    limit,
    remaining: limit - hits.length,
    reset: Math.ceil((now + windowMs) / 1000),
    retryAfter: 0,
  };
}

export async function rateLimit(opts: {
  key: string;
  limit: number;
  windowSec: number;
}): Promise<RateResult> {
  if (redis) {
    const r = await upstashLimiter(opts.limit, opts.windowSec).limit(opts.key);
    const resetSec = Math.ceil(r.reset / 1000);
    return {
      ok: r.success,
      limit: r.limit,
      remaining: Math.max(0, r.remaining),
      reset: resetSec,
      retryAfter: r.success ? 0 : Math.max(1, resetSec - Math.floor(Date.now() / 1000)),
    };
  }
  return memoryLimit(opts.key, opts.limit, opts.windowSec);
}

/** Standard 429 body + headers. */
export function rateLimitResponse(r: RateResult): Response {
  return new Response(
    JSON.stringify({ error: "Rate limit exceeded", retry_after_seconds: r.retryAfter }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(r.retryAfter),
        "X-RateLimit-Limit": String(r.limit),
        "X-RateLimit-Remaining": String(r.remaining),
        "X-RateLimit-Reset": String(r.reset),
      },
    }
  );
}

/** Rate-limit headers to attach to a successful (non-429) response. */
export function rateLimitHeaders(r: RateResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(r.reset),
  };
}

/** Best-effort client IP from proxy headers. */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "0.0.0.0";
}

/** Read a per-route limit from env with a default. */
export function envLimit(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
