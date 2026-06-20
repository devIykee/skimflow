import { NextRequest } from "next/server";
import { requireAdmin, errorResponse, HttpError } from "@/lib/session";
import { getLedgerByToken, finalizeLedgerByToken, failLedgerByToken, recordAdminEvent } from "@/lib/store";
import { settlePendingByToken } from "@/lib/settle";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/admin/payments/:token/settle — reconcile a stuck pending payment.
 *   action "retry"          → re-run mint→split from the stored attestation
 *   action "mark_completed" → override with a verified on-chain txHash
 *   action "mark_failed"    → mark the row failed
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const admin = await requireAdmin();
    const { token } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { action?: string; txHash?: string };
    const action = body.action ?? "retry";

    const row = await getLedgerByToken(token);
    if (!row) throw new HttpError(404, "not_found", "No payment with that token.");

    if (action === "mark_failed") {
      const r = await failLedgerByToken(token);
      void recordAdminEvent({ eventType: "PAYOUT", actorId: admin.id, metadata: { kind: "settle_mark_failed", token } });
      return Response.json({ ok: !!r, status: r?.status ?? row.status });
    }

    if (action === "mark_completed") {
      if (!body.txHash) throw new HttpError(400, "missing_tx", "Provide the on-chain tx hash.");
      const r = await finalizeLedgerByToken(token, body.txHash);
      void recordAdminEvent({ eventType: "PAYOUT", actorId: admin.id, metadata: { kind: "settle_mark_completed", token, txHash: body.txHash } });
      return Response.json({ ok: !!r, status: r?.status ?? "completed" });
    }

    // Default: retry mint→split from the stored attestation.
    const result = await settlePendingByToken(token);
    if (!result.ok) {
      const friendly =
        result.reason === "not_retryable"
          ? "This row has no stored attestation (e.g. an x402 batch) — use Mark completed with a verified tx hash, or Mark failed."
          : result.reason === "not_pending"
            ? "Already resolved."
            : "Couldn't settle this row.";
      throw new HttpError(422, result.reason ?? "settle_failed", friendly);
    }
    void recordAdminEvent({ eventType: "PAYOUT", actorId: admin.id, metadata: { kind: "settle_retry", token, splitTx: result.splitTx } });
    return Response.json({ ok: true, status: "completed", splitTx: result.splitTx });
  } catch (e) {
    return errorResponse(e);
  }
}
