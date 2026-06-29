import { NextRequest } from "next/server";
import { errorResponse, HttpError, resolveActingUser } from "@/lib/session";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/notifications/read — mark notifications read.
 *   { notificationId } → mark that one (scoped to the owner).
 *   {}                 → mark all of the user's notifications read.
 */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await resolveActingUser();
    const body = (await req.json().catch(() => ({}))) as { notificationId?: string };
    const id = body.notificationId?.trim();
    if (id) {
      if (!UUID_RE.test(id)) throw new HttpError(400, "invalid_id", "Invalid notification id.");
      await markNotificationRead(id, ctx.user.id);
    } else {
      await markAllNotificationsRead(ctx.user.id);
    }
    return Response.json({ success: true });
  } catch (e) {
    return errorResponse(e);
  }
}
