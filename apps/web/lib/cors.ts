/**
 * CORS policy. Explicit per route group — no implicit wildcards on auth/admin.
 * Edge-safe (pure header logic), used by middleware.ts and route handlers.
 *
 *   public (readers, marketplace, .well-known) → any origin, GET only
 *   agent payment route                        → any origin, GET, + Last-Event-ID
 *   auth / creator / import / dashboard        → NEXT_PUBLIC_APP_URL only, credentials
 *   admin                                      → NEXT_PUBLIC_APP_URL only, credentials
 *   webhook                                    → no CORS (reject browser Origin)
 */
export interface CorsPolicy {
  origin: string; // "*" or a specific origin
  methods: string;
  headers: string;
  credentials: boolean;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "*";
const AGENT_RE = /^\/read\/[^/]+\/agent-skills\.md$/;

/** Resolve the policy for a path, or null when no CORS headers apply. */
export function corsPolicyFor(pathname: string): CorsPolicy | null {
  // Webhooks are server-to-server: no CORS, and we reject any Origin upstream.
  if (pathname.startsWith("/api/webhooks/")) return null;

  // Agent payment route — public, plus Last-Event-ID for resumable reads.
  if (AGENT_RE.test(pathname)) {
    return {
      origin: "*",
      methods: "GET, OPTIONS",
      headers: "X-Payment-Token, Content-Type, Last-Event-ID",
      credentials: false,
    };
  }

  // Admin — locked to the app origin, credentials required.
  if (pathname.startsWith("/api/admin")) {
    return { origin: APP_URL, methods: "GET, POST, DELETE, OPTIONS", headers: "Content-Type", credentials: true };
  }

  // Public creator posts + RSS feed (PLURAL /api/creators/…). Must come BEFORE
  // the credentialed /api/creator (singular) rule below, which would otherwise
  // match the plural prefix and wrongly lock these public endpoints down.
  if (pathname.startsWith("/api/creators/")) {
    return { origin: "*", methods: "GET, OPTIONS", headers: "Content-Type", credentials: false };
  }

  // Auth / creator / dashboard — locked to the app origin, credentials.
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/creator") ||
    pathname.startsWith("/dashboard")
  ) {
    return {
      origin: APP_URL,
      methods: "GET, POST, PUT, DELETE, OPTIONS",
      headers: "Content-Type",
      credentials: true,
    };
  }

  // Public — readers, marketplace, catalog, well-known. GET only.
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/read/") ||
    pathname.startsWith("/.well-known/")
  ) {
    return { origin: "*", methods: "GET, OPTIONS", headers: "X-Payment-Token, Content-Type", credentials: false };
  }

  return null;
}

/** Build the response headers for a policy, echoing a credentialed origin. */
export function corsHeaders(policy: CorsPolicy, requestOrigin: string | null): Headers {
  const h = new Headers();
  if (policy.credentials) {
    // Credentialed responses cannot use "*": echo the configured app origin
    // (or the request origin if it matches), and Vary on Origin.
    const allowed = policy.origin === "*" ? requestOrigin ?? "*" : policy.origin;
    h.set("Access-Control-Allow-Origin", allowed);
    h.set("Access-Control-Allow-Credentials", "true");
    h.set("Vary", "Origin");
  } else {
    h.set("Access-Control-Allow-Origin", policy.origin);
  }
  h.set("Access-Control-Allow-Methods", policy.methods);
  h.set("Access-Control-Allow-Headers", policy.headers);
  h.set("Access-Control-Max-Age", "86400");
  return h;
}

/** Apply CORS headers from a policy onto an existing Headers object. */
export function applyCors(target: Headers, policy: CorsPolicy, requestOrigin: string | null): void {
  corsHeaders(policy, requestOrigin).forEach((v, k) => target.set(k, v));
}
