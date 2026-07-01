import { NextRequest } from "next/server";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { getCommentLikeCount, likeComment, unlikeComment } from "@/lib/store";
import { UUID_RE } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/comments/:id/like — like a comment. Idempotent. (No notification — too noisy.) */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id: commentId } = await ctx.params;
    if (!UUID_RE.test(commentId)) throw new HttpError(400, "invalid_comment_id", "Invalid comment id.");
    await likeComment(me.id, commentId);
    const likeCount = await getCommentLikeCount(commentId);
    return Response.json({ liked: true, likeCount });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/comments/:id/like — unlike a comment. Idempotent. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id: commentId } = await ctx.params;
    if (!UUID_RE.test(commentId)) throw new HttpError(400, "invalid_comment_id", "Invalid comment id.");
    await unlikeComment(me.id, commentId);
    const likeCount = await getCommentLikeCount(commentId);
    return Response.json({ liked: false, likeCount });
  } catch (e) {
    return errorResponse(e);
  }
}
