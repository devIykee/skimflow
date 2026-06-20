import { NextRequest } from "next/server";
import { getAddress, verifyMessage } from "viem";
import type { Address, Hex } from "viem";
import { createPaySession } from "@/lib/store";
import { currentSession } from "@/lib/session";
import { getUserById } from "@/lib/store";
import { validateWallet } from "@/lib/validate-wallet";
import { normalizeUsdc } from "@/lib/money";
import { paySessionAuthMessage } from "@/lib/burn-intent";
import { relayerRecipient } from "@/lib/gateway-relayer";
import { PAY_SESSION_COOKIE, signPaySession } from "@/lib/session-key";

export const runtime = "nodejs";

/**
 * POST /api/pay-session/init — open a silent-payment session.
 *
 * The browser sends the connected main wallet, its locally-generated session
 * key address, a spend cap, and a signature from the main wallet over the
 * canonical authorization message (proves wallet ownership + binds the key/cap).
 * We persist the session, then set a signed httpOnly cookie the reader route
 * trusts. In live mode the real on-chain `addDelegate` + deposit are done by
 * the client before calling this; here we only record the authorization.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      mainWallet?: string;
      sessionAddress?: string;
      cap?: string | number;
      signature?: Hex;
      source?: "embedded" | "external";
    };

    const mainCheck = validateWallet(body.mainWallet);
    if (!mainCheck.valid || !mainCheck.checksummed)
      return Response.json({ error: "bad_main_wallet", friendly: mainCheck.error }, { status: 400 });
    const sessCheck = validateWallet(body.sessionAddress);
    if (!sessCheck.valid || !sessCheck.checksummed)
      return Response.json({ error: "bad_session_address" }, { status: 400 });

    // The cap string EXACTLY as the client signed it (don't normalize before
    // verifying — the wallet signed the raw value, e.g. "5", not "5.000000").
    const signedCap = String(body.cap ?? "").trim();
    let cap: string;
    try {
      cap = normalizeUsdc(signedCap);
    } catch {
      return Response.json({ error: "bad_cap", friendly: "Enter a valid spend cap." }, { status: 400 });
    }
    if (Number(cap) <= 0) return Response.json({ error: "bad_cap", friendly: "Cap must be greater than 0." }, { status: 400 });

    const mainWallet = mainCheck.checksummed as Address;
    const sessionAddress = sessCheck.checksummed as Address;

    // Authorize ownership of `mainWallet`:
    //  • embedded → the wallet was minted by us for this signed-in user, so the
    //    NextAuth session IS the proof. No on-chain signature is needed (the SCA
    //    would sign via ERC-1271, which isn't EOA-recoverable anyway).
    //  • external → verify the one-time EOA signature over the bound message,
    //    rebuilt with the SAME cap string the client signed (so digests match).
    if (body.source === "embedded") {
      const session = await currentSession();
      if (!session?.user?.id)
        return Response.json({ error: "unauthorized", friendly: "Sign in to use your wallet." }, { status: 401 });
      const user = await getUserById(session.user.id);
      const owns =
        user?.embedded_wallet_address &&
        getAddress(user.embedded_wallet_address) === mainWallet;
      if (!owns)
        return Response.json({ error: "embedded_mismatch", friendly: "That isn't your embedded wallet." }, { status: 403 });
    } else {
      const message = paySessionAuthMessage({ mainWallet, sessionAddress, cap: signedCap });
      if (!body.signature) return Response.json({ error: "missing_signature" }, { status: 400 });
      let valid = false;
      try {
        valid = await verifyMessage({ address: mainWallet, message, signature: body.signature });
      } catch {
        valid = false;
      }
      if (!valid)
        return Response.json({ error: "bad_signature", friendly: "Authorization signature didn't verify." }, { status: 401 });
    }

    const session = await createPaySession({ mainWallet, sessionAddress, cap });
    const token = await signPaySession({
      sessionId: session.id,
      mainWallet,
      sessionAddress,
      cap,
    });

    const res = Response.json({
      ok: true,
      sessionId: session.id,
      sessionAddress,
      mainWallet,
      cap,
      spent: session.spent,
      remaining: cap,
      recipient: getAddress(relayerRecipient()),
    });
    res.headers.append(
      "Set-Cookie",
      `${PAY_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
    );
    return res;
  } catch (e) {
    return Response.json({ error: "init_failed", detail: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}
