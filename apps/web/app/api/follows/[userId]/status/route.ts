import { NextRequest } from "next/server";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { getFollowerCount, getFollowingCount, isFollowing } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/follows/:userId/status — does the current user follow :userId, plus
 * :userId's follower/following counts. Powers the creator-profile follow button.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  try {
    const me = await requireUser();
    const { userId } = await ctx.params;
    if (!UUID_RE.test(userId)) {
      throw new HttpError(400, "invalid_user_id", "Invalid user id.");
    }
    const [following, followerCount, followingCount] = await Promise.all([
      isFollowing(me.id, userId),
      getFollowerCount(userId),
      getFollowingCount(userId),
    ]);
    return Response.json({ following, followerCount, followingCount });
  } catch (e) {
    return errorResponse(e);
  }
}
