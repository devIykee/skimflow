import { NextRequest } from "next/server";
import { requireUser, errorResponse, HttpError } from "@/lib/session";
import { setPayoutSource } from "@/lib/store";
import { validateWallet } from "@/lib/validate-wallet";

export const runtime = "nodejs";

/**
 * POST /api/creator/payout-source — switch which wallet receives payouts.
 *   { source: "embedded" }                    → point payouts at the embedded wallet
 *   { source: "external", wallet: "0x…" }     → point payouts at an external address
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as { source?: "embedded" | "external"; wallet?: string };

    if (body.source === "embedded") {
      const updated = await setPayoutSource(user.id, "embedded");
      if (!updated)
        throw new HttpError(409, "no_embedded_wallet", "Create your free wallet first.");
      return Response.json({ ok: true, walletAddress: updated.wallet_address, walletSource: updated.wallet_source });
    }

    if (body.source === "external") {
      const check = validateWallet(body.wallet);
      if (!check.valid || !check.checksummed)
        throw new HttpError(400, "invalid_wallet", check.error ?? "Invalid wallet address.");
      const updated = await setPayoutSource(user.id, "external", check.checksummed);
      return Response.json({ ok: true, walletAddress: updated?.wallet_address, walletSource: updated?.wallet_source });
    }

    throw new HttpError(400, "bad_source", "Choose embedded or external.");
  } catch (e) {
    return errorResponse(e);
  }
}
