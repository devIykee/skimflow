import { NextRequest } from "next/server";
import { errorResponse, resolveActingUser } from "@/lib/session";
import {
  getUnreadNotificationCount,
  listNotificationsEnriched,
  markNotificationsRead,
  type NotificationEnriched,
} from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Client-facing shape: social notifications + legacy (Ghost) title/body/link. */
function serializeNotification(n: NotificationEnriched) {
  return {
    id: n.id,
    type: n.type,
    read: n.read,
    createdAt: new Date(n.created_at).toISOString(),
    actor: n.actor_id
      ? { id: n.actor_id, name: n.actor_name, handle: n.actor_handle, avatarUrl: n.actor_avatar }
      : null,
    postId: n.post_id,
    postTitle: n.post_title,
    postSlug: n.post_slug,
    commentId: n.comment_id,
    commentPreview: n.comment_preview,
    // Legacy Ghost fields (null for social notifications).
    title: n.title,
    body: n.body,
    link: n.link,
  };
}

/** GET — the acting user's notifications (paginated) + unread count. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveActingUser();
    const sp = req.nextUrl.searchParams;
    const page = Math.max(Number(sp.get("page")) || 1, 1);
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 20, 1), 50);

    const [items, unreadCount] = await Promise.all([
      listNotificationsEnriched(ctx.user.id, page, limit),
      getUnreadNotificationCount(ctx.user.id),
    ]);
    return Response.json({
      notifications: items.map(serializeNotification),
      pagination: { page, limit, hasMore: items.length === limit },
      unreadCount,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST — legacy mark-read endpoint ({ ids } to target specific ones, or all).
 * Retained for backward compatibility; new clients use PATCH /api/notifications/read.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveActingUser();
    const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
    await markNotificationsRead(ctx.user.id, Array.isArray(body.ids) ? body.ids : undefined);
    const unreadCount = await getUnreadNotificationCount(ctx.user.id);
    return Response.json({ ok: true, unreadCount });
  } catch (e) {
    return errorResponse(e);
  }
}
