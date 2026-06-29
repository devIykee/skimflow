import { errorResponse, resolveActingUser } from "@/lib/session";
import { getUnreadNotificationCount } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/notifications/unread-count — lightweight poll target for the bell. */
export async function GET() {
  try {
    const ctx = await resolveActingUser();
    const unreadCount = await getUnreadNotificationCount(ctx.user.id);
    return Response.json({ unreadCount });
  } catch (e) {
    return errorResponse(e);
  }
}
