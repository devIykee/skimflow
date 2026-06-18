import { cookies } from "next/headers";
import { revokePaySession } from "@/lib/store";
import { PAY_SESSION_COOKIE, verifyPaySession } from "@/lib/session-key";

export const runtime = "nodejs";

/**
 * POST /api/pay-session/revoke — end the current silent-payment session and
 * clear the cookie. The local session key should also be cleared client-side
 * (clearSessionKey). In live mode the user additionally calls removeDelegate +
 * withdraws their remaining Gateway deposit from their own wallet.
 */
export async function POST() {
  const jar = await cookies();
  const cookie = jar.get(PAY_SESSION_COOKIE)?.value;
  if (cookie) {
    const claims = await verifyPaySession(cookie);
    if (claims) await revokePaySession(claims.sessionId).catch(() => undefined);
  }
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${PAY_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}
