import { NextRequest } from "next/server";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import {
  createComment,
  createSocialNotification,
  deleteComment,
  getCommentById,
  getCommentCount,
  getCommentsByPost,
  getContentById,
} from "@/lib/store";
import { serializeComment, UUID_RE } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// NOTE on the [id] param: for GET/POST it is a POST (content) id; for DELETE it
// is a COMMENT id. This mirrors the spec's URLs — POST /api/comments/:postId and
// DELETE /api/comments/:commentId share the same /api/comments/:id shape.

const MAX_LEN = 1000;

/** GET /api/comments/:postId — public. Top-level comments + reply counts. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: postId } = await ctx.params;
    if (!UUID_RE.test(postId)) throw new HttpError(400, "invalid_post_id", "Invalid post id.");
    const sp = req.nextUrl.searchParams;
    const page = Math.max(Number(sp.get("page")) || 1, 1);
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 20, 1), 100);

    const [comments, total] = await Promise.all([
      getCommentsByPost(postId, page, limit),
      getCommentCount(postId),
    ]);
    return Response.json({
      comments: comments.map(serializeComment),
      pagination: { page, limit, total, hasMore: comments.length === limit },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/comments/:postId — auth required. Body: { content, parentId? }.
 * Enforces single-level nesting and fires the right notification (post author
 * for top-level comments, parent author for replies), fire-and-forget.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id: postId } = await ctx.params;
    if (!UUID_RE.test(postId)) throw new HttpError(400, "invalid_post_id", "Invalid post id.");

    const body = (await req.json().catch(() => ({}))) as { content?: string; parentId?: string };
    const content = (body.content ?? "").trim();
    if (!content) throw new HttpError(400, "empty_comment", "Comment can't be empty.");
    if (content.length > MAX_LEN) {
      throw new HttpError(400, "comment_too_long", `Comments are limited to ${MAX_LEN} characters.`);
    }

    const post = await getContentById(postId);
    if (!post || post.status !== "published") {
      throw new HttpError(404, "post_not_found", "Post not found.");
    }

    // Validate the parent (same post, top-level only) at the API layer too.
    const parentId = body.parentId?.trim() || undefined;
    let parentAuthorId: string | null = null;
    if (parentId) {
      if (!UUID_RE.test(parentId)) throw new HttpError(400, "invalid_parent", "Invalid parent comment.");
      const parent = await getCommentById(parentId);
      if (!parent || parent.post_id !== postId) {
        throw new HttpError(400, "invalid_parent", "Parent comment not found on this post.");
      }
      if (parent.parent_id !== null) {
        throw new HttpError(400, "nesting_too_deep", "Replies can't be nested more than one level.");
      }
      parentAuthorId = parent.user_id;
    }

    const comment = await createComment(postId, me.id, content, parentId);

    // Fire-and-forget; a failed notification never blocks the comment.
    if (parentId && parentAuthorId) {
      await createSocialNotification(parentAuthorId, me.id, "comment_reply", postId, comment.id);
    } else {
      await createSocialNotification(post.creator_id, me.id, "post_comment", postId, comment.id);
    }

    return Response.json({ comment: serializeComment(comment) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/comments/:commentId — auth required. Author-only. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id: commentId } = await ctx.params;
    if (!UUID_RE.test(commentId)) throw new HttpError(400, "invalid_comment_id", "Invalid comment id.");
    const ok = await deleteComment(commentId, me.id);
    if (!ok) {
      throw new HttpError(403, "forbidden", "You can only delete your own comments.");
    }
    return Response.json({ deleted: true });
  } catch (e) {
    return errorResponse(e);
  }
}
