import { requireAdmin, errorResponse } from "@/lib/session";
import { listPendingLedger, recordAdminEvent } from "@/lib/store";
import { settlePendingByToken } from "@/lib/settle";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/admin/payments/settle-all — retry every retryable pending row
 * (sequentially; the relayer is one EOA). Rows without a stored attestation are
 * skipped and reported as `skipped` for manual override.
 */
export async function POST() {
  try {
    const admin = await requireAdmin();
    const pending = await listPendingLedger(200);

    const results: Array<{ token: string; ok: boolean; reason?: string; splitTx?: string }> = [];
    for (const row of pending) {
      if (!row.payment_token) continue;
      try {
        const r = await settlePendingByToken(row.payment_token);
        results.push(r);
      } catch (e) {
        results.push({ token: row.payment_token, ok: false, reason: String((e as Error)?.message ?? e).slice(0, 160) });
      }
    }

    const settled = results.filter((r) => r.ok).length;
    void recordAdminEvent({ eventType: "PAYOUT", actorId: admin.id, metadata: { kind: "settle_all", settled, total: results.length } });
    return Response.json({ ok: true, settled, total: results.length, results });
  } catch (e) {
    return errorResponse(e);
  }
}
