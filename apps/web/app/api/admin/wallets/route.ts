import { NextRequest } from "next/server";
import { getAddress } from "viem";
import type { Address } from "viem";
import { requireAdmin, errorResponse } from "@/lib/session";
import { listWalletUsers } from "@/lib/store";
import { readBalances } from "@/lib/gateway-relayer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/wallets — all users with their embedded + external wallets and
 * live on-chain USDC (6-dec) + gas (18-dec) balances, for the admin Wallets
 * table + batch funder. `sort=balance_asc` orders by lowest USDC after the
 * (best-effort) balance reads.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const sp = req.nextUrl.searchParams;
    const search = sp.get("search") ?? undefined;
    const sort = (sp.get("sort") ?? "newest") as
      | "newest"
      | "oldest"
      | "balance_asc"
      | "balance_desc";

    const dbSort = sort === "oldest" ? "oldest" : "newest";
    const users = await listWalletUsers({ search, sort: dbSort, limit: 300 });

    // Read balances for the funding-target address (embedded preferred, else
    // the active payout). Best-effort: an RPC hiccup leaves balances null.
    const rows = await Promise.all(
      users.map(async (u) => {
        const target = u.embedded_wallet_address ?? u.wallet_address;
        let usdc: string | null = null;
        let gas: string | null = null;
        if (target) {
          try {
            const b = await readBalances(getAddress(target) as Address);
            usdc = b.usdc;
            gas = b.gas;
          } catch {
            /* leave null */
          }
        }
        return {
          id: u.id,
          email: u.email,
          displayName: u.display_name,
          handle: u.handle,
          role: u.role,
          embeddedAddress: u.embedded_wallet_address,
          externalAddress: u.wallet_source === "external" ? u.wallet_address : null,
          payoutAddress: u.wallet_address,
          walletSource: u.wallet_source,
          fundingAddress: target,
          usdc,
          gas,
          createdAt: u.created_at,
        };
      })
    );

    if (sort === "balance_asc" || sort === "balance_desc") {
      rows.sort((a, b) => {
        const av = a.usdc == null ? Infinity : Number(a.usdc);
        const bv = b.usdc == null ? Infinity : Number(b.usdc);
        return sort === "balance_asc" ? av - bv : bv - av;
      });
    }

    return Response.json({ rows });
  } catch (e) {
    return errorResponse(e);
  }
}
