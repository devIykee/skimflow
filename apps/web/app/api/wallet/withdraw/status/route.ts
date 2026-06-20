import { NextRequest } from "next/server";
import { requireUser, errorResponse, HttpError } from "@/lib/session";
import { issueUserToken, getWalletTransaction } from "@/lib/circle-wallets";

export const runtime = "nodejs";

/**
 * GET /api/wallet/withdraw/status?txId=… — poll a withdrawal's settlement state.
 * Circle is the source of truth (no local table for v1). Maps Circle's
 * transaction states into a small pending/confirmed/failed status for the UI.
 */
function mapState(state: string): "pending" | "confirmed" | "failed" {
  const s = state.toUpperCase();
  if (["COMPLETE", "CONFIRMED"].includes(s)) return "confirmed";
  if (["FAILED", "CANCELLED", "DENIED"].includes(s)) return "failed";
  return "pending"; // INITIATED / QUEUED / SENT / PENDING_RISK_SCREENING …
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const txId = req.nextUrl.searchParams.get("txId");
    if (!txId) throw new HttpError(400, "missing_tx", "Missing txId.");

    const { userToken } = await issueUserToken(user.id);
    const tx = await getWalletTransaction(userToken, txId);
    if (!tx) return Response.json({ status: "pending", state: "unknown" });

    return Response.json({
      status: mapState(tx.state),
      state: tx.state,
      txHash: tx.txHash ?? null,
      amount: tx.amounts?.[0] ?? null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
