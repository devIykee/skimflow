/**
 * Signed pay-session tokens for silent chunk payments. The browser generates a
 * local session keypair and authorizes it once (deposit + addDelegate); this
 * JWT — stored in an httpOnly cookie — binds the server's notion of "which
 * session key is allowed to spend, on behalf of which main wallet, up to what
 * cap". Every silent payment is checked against it. Uses jose (HS256) like
 * impersonation.ts so it works in both the edge and node runtimes.
 */
import { SignJWT, jwtVerify } from "jose";

export const PAY_SESSION_COOKIE = "linepay_pay_session";

/** Default lifetime of a pay session if the caller doesn't specify one. */
export const PAY_SESSION_TTL = "30d";

function secret(): Uint8Array {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET (or AUTH_SECRET) must be set to sign pay-session tokens.");
  return new TextEncoder().encode(s);
}

export interface PaySessionClaims {
  /** pay_sessions.id */
  sessionId: string;
  /** depositor / main wallet (EIP-55) */
  mainWallet: string;
  /** local delegate key address that signs burn intents */
  sessionAddress: string;
  /** authorized spend cap, decimal USDC string */
  cap: string;
}

export async function signPaySession(
  claims: PaySessionClaims,
  ttl: string = PAY_SESSION_TTL
): Promise<string> {
  return new SignJWT({
    sessionId: claims.sessionId,
    mainWallet: claims.mainWallet,
    sessionAddress: claims.sessionAddress,
    cap: claims.cap,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret());
}

export async function verifyPaySession(token: string): Promise<PaySessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (
      typeof payload.sessionId === "string" &&
      typeof payload.mainWallet === "string" &&
      typeof payload.sessionAddress === "string" &&
      typeof payload.cap === "string"
    ) {
      return {
        sessionId: payload.sessionId,
        mainWallet: payload.mainWallet,
        sessionAddress: payload.sessionAddress,
        cap: payload.cap,
      };
    }
    return null;
  } catch {
    return null;
  }
}
