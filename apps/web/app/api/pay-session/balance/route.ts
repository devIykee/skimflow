import { cookies } from "next/headers";
import type { Address } from "viem";
import { getPaySessionById } from "@/lib/store";
import { toDecimal, toBaseUnits } from "@/lib/money";
import { PAY_SESSION_COOKIE, verifyPaySession } from "@/lib/session-key";
import { gatewayBalance } from "@/lib/gateway-relayer";

export const runtime = "nodejs";

/**
 * GET /api/pay-session/balance — remaining silent-spend allowance for the
 * current device. The cap/spent tally is the source of truth in simulate; in
 * live mode this still reflects what the relayer will allow before the on-chain
 * Gateway balance runs out (which is checked at settle time).
 */
export async function GET() {
  const cookie = (await cookies()).get(PAY_SESSION_COOKIE)?.value;
  if (!cookie) return Response.json({ active: false });

  const claims = await verifyPaySession(cookie);
  if (!claims) return Response.json({ active: false });

  const session = await getPaySessionById(claims.sessionId);
  if (!session || session.status !== "active") {
    return Response.json({ active: false, status: session?.status ?? "missing" });
  }

  const remaining = toDecimal(toBaseUnits(session.cap) - toBaseUnits(session.spent));

  // In live mode, surface the real on-chain Gateway balance too (best-effort).
  let onChainBalance: string | undefined;
  if ((process.env.PAYMENTS_MODE ?? "simulate").toLowerCase() === "live") {
    try {
      onChainBalance = toDecimal(await gatewayBalance(session.main_wallet as Address));
    } catch {
      /* RPC/API hiccup — omit */
    }
  }

  return Response.json({
    active: true,
    sessionId: session.id,
    mainWallet: session.main_wallet,
    sessionAddress: session.session_address,
    cap: session.cap,
    spent: session.spent,
    remaining,
    onChainBalance,
  });
}
