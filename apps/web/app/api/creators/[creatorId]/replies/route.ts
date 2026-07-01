import { NextRequest } from "next/server";
import { errorResponse, HttpError } from "@/lib/session";
import { listCommentsByUser } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/creators/:creatorId/replies — a user's own comments (profile Replies tab). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ creatorId: string }> }) {
  try {
    const { creatorId } = await ctx.params;
    if (!UUID_RE.test(creatorId)) throw new HttpError(400, "invalid_id", "Invalid creator id.");
    const rows = await listCommentsByUser(creatorId);
    return Response.json({
      replies: rows.map((r) => ({
        id: r.id,
        content: r.content,
        createdAt: new Date(r.created_at).toISOString(),
        postTitle: r.post_title,
        postSlug: r.post_slug,
        url: `/read/${r.post_slug}`,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
