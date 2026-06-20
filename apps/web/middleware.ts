import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config.js";
import { applyCors, corsPolicyFor } from "./lib/cors.js";
import { persistReferral } from "./lib/referral.js";

/**
 * Edge middleware. Uses the DB-free authConfig (so `pg` never enters the edge
 * bundle). Responsibilities:
 *  - Route protection for /dashboard and /admin (via authConfig.authorized).
 *  - Webhook hardening: reject any browser-originated request to /api/webhooks/*.
 *  - CORS: answer OPTIONS preflight (204) and attach headers per policy.
 *
 * Rate limiting is intentionally NOT here — it runs inside route handlers
 * (Node) where the agent-session / trusted lookups live.
 */
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get("origin");

  // Webhooks are server-to-server. A browser Origin header means a forgery
  // attempt — reject it outright (no CORS headers either).
  if (pathname.startsWith("/api/webhooks/")) {
    if (origin) return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
    return NextResponse.next();
  }

  const policy = corsPolicyFor(pathname);

  // Preflight.
  if (req.method === "OPTIONS" && policy) {
    const res = new NextResponse(null, { status: 204 });
    applyCors(res.headers, policy, origin);
    return res;
  }

  const res = NextResponse.next();
  if (policy) applyCors(res.headers, policy, origin);
  // Capture ?ref=<creatorId> from any shared link into the referral cookie so
  // later purchases on this device credit the referrer. No-op when ?ref= absent.
  persistReferral(req, res);
  return res;
});

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|map|woff|woff2|ttf)$).*)",
  ],
};
