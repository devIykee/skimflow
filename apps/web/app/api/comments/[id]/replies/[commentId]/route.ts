import { NextRequest } from "next/server";
import { currentSession, errorResponse, HttpError } from "@/lib/session";
import { getCommentLikeCounts, getRepliesByComment, likedCommentIdsFor } from "@/lib/store";
import { serializeComment, UUID_RE } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/comments/:postId/replies/:commentId — public. All replies, oldest first. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const { commentId } = await ctx.params;
    if (!UUID_RE.test(commentId)) throw new HttpError(400, "invalid_comment_id", "Invalid comment id.");
    const replies = await getRepliesByComment(commentId);
    const ids = replies.map((r) => r.id);
    const session = await currentSession();
    const [counts, liked] = await Promise.all([
      getCommentLikeCounts(ids),
      likedCommentIdsFor(session?.user?.id ?? null, ids),
    ]);
    return Response.json({
      replies: replies.map((r) =>
        serializeComment(r, { count: counts.get(r.id) ?? 0, liked: liked.has(r.id) })
      ),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
