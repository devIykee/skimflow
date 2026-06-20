/**
 * Referral tracking. A `?ref=<referrerId>` on any reader/agent URL is captured
 * into a cookie; the referrer cut is then applied to that visitor's purchases
 * for the cookie's lifetime.
 */
import type { NextRequest } from "next/server";

export const REFERRAL_COOKIE = "skimflow_ref";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** Resolve the active referrer id from query (?ref=) then cookie. */
export function getReferrerId(req: NextRequest): string | null {
  const fromQuery = req.nextUrl.searchParams.get("ref");
  if (fromQuery && fromQuery.trim()) return fromQuery.trim();
  const fromCookie = req.cookies.get(REFERRAL_COOKIE)?.value;
  return fromCookie?.trim() || null;
}

/** If ?ref= is present, persist it on the response so later purchases credit it. */
export function persistReferral(req: NextRequest, res: Response): void {
  const ref = req.nextUrl.searchParams.get("ref");
  if (!ref || !ref.trim()) return;
  res.headers.append(
    "Set-Cookie",
    `${REFERRAL_COOKIE}=${encodeURIComponent(ref.trim())}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`
  );
}
