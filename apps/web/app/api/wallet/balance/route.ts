import { currentSession } from "@/lib/session";
import { getUserById } from "@/lib/store";
import { readBalances, gatewayBalance } from "@/lib/gateway-relayer";
import { toDecimal } from "@/lib/money";
import type { Address } from "viem";

export const runtime = "nodejs";

/**
 * GET /api/wallet/balance — a cheap, pollable snapshot of the signed-in user's
 * spendable USDC. Deliberately lighter than /api/wallet/overview (no Circle
 * transaction history): the DepositWatcher hits this every ~25s to notice when
 * an incoming deposit lands in the wallet and surface an in-app toast.
 *
 * Returns { signedIn:false } (200) when there's no session so the client poller
 * stays quiet instead of error-spamming.
 */
export async function GET() {
  const session = await currentSession();
  if (!session?.user?.id) return Response.json({ signedIn: false });

  const user = await getUserById(session.user.id);
  const address = (user?.wallet_address || user?.embedded_wallet_address) as Address | null;
  if (!address) return Response.json({ signedIn: true, address: null });

  // Wallet USDC is the "deposits arrive here" balance; gateway is reading fuel.
  // Both best-effort — a single RPC hiccup shouldn't blank the snapshot.
  let usdc: string | null = null;
  let gateway: string | null = null;
  try {
    usdc = (await readBalances(address)).usdc;
  } catch {
    /* RPC hiccup — omit */
  }
  try {
    gateway = toDecimal(await gatewayBalance(address));
  } catch {
    /* RPC hiccup — omit */
  }

  return Response.json({ signedIn: true, address, usdc, gateway });
}
