import { NextRequest } from "next/server";
import { errorResponse, HttpError } from "@/lib/session";
import { getRepliesByComment } from "@/lib/store";
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
    return Response.json({ replies: replies.map(serializeComment) });
  } catch (e) {
    return errorResponse(e);
  }
}
