import { NextRequest } from "next/server";
import { requireAdmin, errorResponse, HttpError } from "@/lib/session";
import { setReportStatus, recordAdminEvent } from "@/lib/store";
import type { ReportStatus } from "@/lib/types";

export const runtime = "nodejs";

const STATUSES = new Set(["open", "reviewed", "resolved", "dismissed"]);

/**
 * POST /api/admin/reports/:id — set a report's status. Resolution actions
 * (refund, takedown, account action) are a manual admin decision outside this
 * build; this just records triage state. Audited like other admin actions.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { status?: string };
    if (!body.status || !STATUSES.has(body.status)) {
      throw new HttpError(400, "invalid_status", "Status must be open, reviewed, resolved, or dismissed.");
    }
    const updated = await setReportStatus(id, body.status as ReportStatus);
    if (!updated) throw new HttpError(404, "not_found", "Report not found.");
    void recordAdminEvent({
      eventType: "REPORT",
      actorId: admin.id,
      contentId: updated.content_id,
      metadata: { kind: "report_status", reportId: id, status: body.status },
    });
    return Response.json({ ok: true, status: updated.status });
  } catch (e) {
    return errorResponse(e);
  }
}
