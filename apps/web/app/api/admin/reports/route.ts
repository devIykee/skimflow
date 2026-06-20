import { NextRequest } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/session";
import { listReports } from "@/lib/store";
import type { ReportStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["open", "reviewed", "resolved", "dismissed"]);

/** GET /api/admin/reports?status=open — admin reports inbox. */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const s = req.nextUrl.searchParams.get("status");
    const status = s && STATUSES.has(s) ? (s as ReportStatus) : undefined;
    const reports = await listReports(status);
    return Response.json({ reports });
  } catch (e) {
    return errorResponse(e);
  }
}
