import { requireUser, errorResponse } from "@/lib/session";
import { issueUserToken, listWalletTransactions } from "@/lib/circle-wallets";
import { readBalances } from "@/lib/gateway-relayer";
import { listLedger } from "@/lib/store";
import type { Address } from "viem";

export const runtime = "nodejs";

/**
 * GET /api/wallet/overview — everything the user's Wallet tab needs:
 *   • addresses (embedded + external) and which one is the active payout
 *   • on-chain USDC + gas balance of the active payout address
 *   • incoming payments (creator earnings ledger) + outgoing (Circle transfers)
 *
 * Balances and Circle history are best-effort: a failure in one doesn't blank
 * the whole tab.
 */
export async function GET() {
  try {
    const user = await requireUser();

    const fundingAddress = (user.wallet_address || user.embedded_wallet_address) as Address | null;

    let balance: { usdc: string; gas: string } | null = null;
    if (fundingAddress) {
      try {
        balance = await readBalances(fundingAddress);
      } catch {
        balance = null;
      }
    }

    // Incoming: this user's completed/pending earnings as a creator.
    const incoming = (await listLedger({ creatorId: user.id, limit: 50 })).map((r) => ({
      id: r.id,
      kind: "incoming" as const,
      title: r.content_title ?? "Payment",
      amount: r.creator_amount,
      status: r.status,
      createdAt: r.created_at,
      txHash: r.tx_hash,
    }));

    // Outgoing: Circle wallet transactions (withdrawals) for embedded wallets.
    let outgoing: Array<{
      id: string;
      kind: "outgoing";
      title: string;
      amount: string;
      status: string;
      createdAt: string | null;
      txHash: string | null;
    }> = [];
    if (user.embedded_wallet_id) {
      try {
        const { userToken } = await issueUserToken(user.id);
        const txs = await listWalletTransactions(userToken, user.embedded_wallet_id);
        outgoing = txs
          .filter((t) => (t.operation ?? "").toUpperCase().includes("TRANSFER") && t.destinationAddress)
          .map((t) => ({
            id: t.id,
            kind: "outgoing" as const,
            title: `Withdrawal to ${t.destinationAddress?.slice(0, 6)}…${t.destinationAddress?.slice(-4)}`,
            amount: t.amounts?.[0] ?? "0",
            status: t.state,
            createdAt: t.createDate ?? null,
            txHash: t.txHash ?? null,
          }));
      } catch {
        outgoing = [];
      }
    }

    return Response.json({
      isAdmin: user.role === "admin",
      walletSource: user.wallet_source,
      payoutAddress: user.wallet_address,
      embeddedAddress: user.embedded_wallet_address,
      hasEmbedded: !!user.embedded_wallet_id,
      fundingAddress,
      balance,
      incoming,
      outgoing,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
