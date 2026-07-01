import { NextRequest } from "next/server";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { createSocialNotification, getContentById, getPostLikeCount, likePost, unlikePost } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/posts/:id/like — like a post. Idempotent. Notifies the author. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id: postId } = await ctx.params;
    if (!UUID_RE.test(postId)) throw new HttpError(400, "invalid_post_id", "Invalid post id.");

    const post = await getContentById(postId);
    if (!post) throw new HttpError(404, "post_not_found", "Post not found.");

    const created = await likePost(me.id, postId);
    // Only notify on a genuinely new like; fire-and-forget (never blocks).
    if (created) {
      await createSocialNotification(post.creator_id, me.id, "post_like", postId);
    }
    const likeCount = await getPostLikeCount(postId);
    return Response.json({ liked: true, likeCount });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/posts/:id/like — unlike a post. Idempotent. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id: postId } = await ctx.params;
    if (!UUID_RE.test(postId)) throw new HttpError(400, "invalid_post_id", "Invalid post id.");
    await unlikePost(me.id, postId);
    const likeCount = await getPostLikeCount(postId);
    return Response.json({ liked: false, likeCount });
  } catch (e) {
    return errorResponse(e);
  }
}
