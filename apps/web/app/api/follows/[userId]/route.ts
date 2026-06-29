import { NextRequest } from "next/server";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { getFollowerCount, unfollowUser } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DELETE /api/follows/:userId — the current user unfollows :userId. Idempotent. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  try {
    const me = await requireUser();
    const { userId } = await ctx.params;
    if (!UUID_RE.test(userId)) {
      throw new HttpError(400, "invalid_user_id", "Invalid user id.");
    }
    await unfollowUser(me.id, userId);
    const followerCount = await getFollowerCount(userId);
    return Response.json({ following: false, followerCount });
  } catch (e) {
    return errorResponse(e);
  }
}
