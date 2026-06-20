import { NextRequest } from "next/server";
import { errorResponse, currentSession } from "@/lib/session";
import { createReport, getContentBySlug, getContentById, recordAdminEvent } from "@/lib/store";
import { envLimit, rateLimit, rateLimitResponse, clientIp } from "@/lib/rate-limit";
import type { ReportType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REASONS = new Set([
  "copyright",
  "scam",
  "inappropriate",
  "broken_link",
  "creator_removed_paid",
  "other",
]);

/**
 * POST /api/reports — file a report (any reader, auth optional).
 *   broken_link    — a paid image's link is dead after settlement (§5b)
 *   content_report — "Report this post" (§2c): copyright / scam / inappropriate
 * Lands in the admin reports inbox (Section 2c). Filing never guarantees a
 * refund/outcome — it guarantees review.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req.headers);
    const rl = await rateLimit({ key: `report:${ip}`, limit: envLimit("RATE_LIMIT_REPORT", 20), windowSec: 300 });
    if (!rl.ok) return rateLimitResponse(rl);

    const body = (await req.json().catch(() => ({}))) as {
      reportType?: string;
      reason?: string;
      detail?: string;
      contentId?: string;
      contentSlug?: string;
      blockIndex?: number;
      amountPaid?: string;
      reporterLabel?: string;
    };

    const reportType: ReportType = body.reportType === "broken_link" ? "broken_link" : "content_report";
    const reason = body.reason && REASONS.has(body.reason) ? body.reason : reportType === "broken_link" ? "broken_link" : "other";

    // Resolve the content (by id or slug) to attach the creator for triage.
    const content = body.contentId
      ? await getContentById(body.contentId)
      : body.contentSlug
        ? await getContentBySlug(body.contentSlug)
        : undefined;
    if (!content) return Response.json({ error: "content_not_found" }, { status: 404 });

    const session = await currentSession();
    const reporterId = session?.user?.id ?? null;

    const report = await createReport({
      reportType,
      reason,
      detail: typeof body.detail === "string" ? body.detail.slice(0, 2000) : null,
      contentId: content.id,
      blockIndex: typeof body.blockIndex === "number" ? body.blockIndex : null,
      creatorId: content.creator_id,
      reporterId,
      reporterLabel: reporterId ? null : body.reporterLabel?.slice(0, 120) ?? null,
      amountPaid: reportType === "broken_link" ? body.amountPaid ?? null : null,
    });

    void recordAdminEvent({
      eventType: "REPORT",
      actorId: reporterId,
      contentId: content.id,
      metadata: { kind: "report_filed", reportType, reason, reportId: report.id },
    });

    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
