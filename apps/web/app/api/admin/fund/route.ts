import { NextRequest } from "next/server";
import { getAddress } from "viem";
import type { Address } from "viem";
import { requireAdmin, errorResponse, HttpError } from "@/lib/session";
import { getUsersByIds, recordAdminEvent } from "@/lib/store";
import { sendGas, sendUsdc } from "@/lib/gateway-relayer";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/admin/fund — testnet batch funding from the relayer. For each
 * selected user we send native gas (USDC at 18-dec) and/or ERC-20 USDC (6-dec)
 * from RELAYER_PRIVATE_KEY. Sequential by design: one relayer EOA, so parallel
 * sends would collide on nonce. Returns a per-user result for live status.
 *
 * Note: on Arc native gas and ERC-20 USDC are SEPARATE balances, so the two
 * amounts fund distinct needs (paying gas vs. depositing/spending).
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as {
      userIds?: string[];
      usdcAmount?: string;
      gasAmount?: string;
    };
    const userIds = Array.isArray(body.userIds) ? body.userIds.slice(0, 200) : [];
    if (!userIds.length) throw new HttpError(400, "no_users", "Select at least one user.");

    const usdcAmount = (body.usdcAmount ?? "").trim();
    const gasAmount = (body.gasAmount ?? "").trim();
    const wantUsdc = !!usdcAmount && Number(usdcAmount) > 0;
    const wantGas = !!gasAmount && Number(gasAmount) > 0;
    if (!wantUsdc && !wantGas)
      throw new HttpError(400, "no_amount", "Enter a USDC and/or gas amount to send.");

    const users = await getUsersByIds(userIds);
    const byId = new Map(users.map((u) => [u.id, u]));

    const results: Array<{
      userId: string;
      address: string | null;
      gasTx?: string;
      usdcTx?: string;
      ok: boolean;
      error?: string;
    }> = [];

    for (const id of userIds) {
      const u = byId.get(id);
      const target = u?.embedded_wallet_address ?? u?.wallet_address ?? null;
      if (!target) {
        results.push({ userId: id, address: null, ok: false, error: "no_wallet" });
        continue;
      }
      const to = getAddress(target) as Address;
      const r: { userId: string; address: string; gasTx?: string; usdcTx?: string; ok: boolean; error?: string } = {
        userId: id,
        address: to,
        ok: true,
      };
      try {
        if (wantGas) r.gasTx = await sendGas(to, gasAmount);
        if (wantUsdc) r.usdcTx = await sendUsdc(to, usdcAmount);
      } catch (e) {
        r.ok = false;
        r.error = String((e as Error)?.message ?? e).slice(0, 200);
      }
      results.push(r);
    }

    const funded = results.filter((r) => r.ok).length;
    void recordAdminEvent({
      eventType: "PAYOUT",
      metadata: {
        kind: "admin_fund",
        count: funded,
        usdcAmount: wantUsdc ? usdcAmount : null,
        gasAmount: wantGas ? gasAmount : null,
      },
    });

    return Response.json({ ok: true, funded, total: userIds.length, results });
  } catch (e) {
    return errorResponse(e);
  }
}
