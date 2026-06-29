import { NextRequest } from "next/server";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { createSocialNotification, followUser, getFollowerCount, getUserById, isFollowing } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/follows — the current user follows { followingId }. Idempotent:
 * following someone you already follow returns 200 without a duplicate row or a
 * duplicate notification. Self-follows are rejected (cannot follow yourself).
 */
export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    const body = (await req.json().catch(() => ({}))) as { followingId?: string };
    const followingId = (body.followingId ?? "").trim();

    if (!UUID_RE.test(followingId)) {
      throw new HttpError(400, "invalid_following_id", "A valid followingId is required.");
    }
    if (followingId === me.id) {
      throw new HttpError(400, "cannot_follow_self", "You can't follow yourself.");
    }
    const target = await getUserById(followingId);
    if (!target || target.suspended) {
      throw new HttpError(404, "user_not_found", "That user doesn't exist.");
    }

    // Idempotent: only insert + notify when the edge is new.
    if (!(await isFollowing(me.id, followingId))) {
      await followUser(me.id, followingId);
      // Fire-and-forget — createSocialNotification never throws.
      await createSocialNotification(followingId, me.id, "new_follower");
    }

    const followerCount = await getFollowerCount(followingId);
    return Response.json({ following: true, followerCount });
  } catch (e) {
    return errorResponse(e);
  }
}
