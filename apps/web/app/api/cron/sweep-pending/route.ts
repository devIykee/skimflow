import { NextRequest } from "next/server";
import { listPendingLedger, recordAdminEvent } from "@/lib/store";
import { settlePendingByToken } from "@/lib/settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Abandoned-payment sweep (§3a). A reader can optimistically unlock a block and
// close the app before the next unlock ever re-attempts settlement — leaving the
// row pending forever. This periodic job settles silent-payment rows that have
// sat pending past the idle timeout, on their own, without waiting for a
// next-block unlock. Rows it can't settle stay pending (surfaced to the reader
// on return, and to admins in Pending settlement).
const SWEEP_IDLE_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * GET /api/cron/sweep-pending — invoked by Vercel Cron (see vercel.json) every
 * ~30 minutes. Guarded by CRON_SECRET (Vercel sends it as a Bearer token); a
 * manual call may pass ?key=<CRON_SECRET>.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const key = req.nextUrl.searchParams.get("key");
    if (auth !== `Bearer ${secret}` && key !== secret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const pending = await listPendingLedger(200);
  const cutoff = Date.now() - SWEEP_IDLE_MS;
  const stale = pending.filter((r) => r.payment_token && new Date(r.created_at).getTime() < cutoff);

  let settled = 0;
  const results: Array<{ token: string; ok: boolean; reason?: string }> = [];
  for (const row of stale) {
    const token = row.payment_token!;
    try {
      const r = await settlePendingByToken(token);
      if (r.ok) settled++;
      results.push({ token, ok: r.ok, reason: r.reason });
    } catch (e) {
      // Leave the row pending — don't write it off silently.
      results.push({ token, ok: false, reason: String((e as Error)?.message ?? e).slice(0, 160) });
    }
  }

  if (stale.length) {
    void recordAdminEvent({
      eventType: "PAYOUT",
      metadata: { kind: "sweep_pending", swept: stale.length, settled },
    });
  }
  return Response.json({ ok: true, swept: stale.length, settled, results });
}
