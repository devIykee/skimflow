import { NextRequest } from "next/server";
import { errorResponse, HttpError } from "@/lib/session";
import { listLikedPostsByUser } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/creators/:creatorId/likes — published posts the user has liked (profile Likes tab). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ creatorId: string }> }) {
  try {
    const { creatorId } = await ctx.params;
    if (!UUID_RE.test(creatorId)) throw new HttpError(400, "invalid_id", "Invalid creator id.");
    const rows = await listLikedPostsByUser(creatorId);
    return Response.json({
      posts: rows.map((c) => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        summary: c.summary,
        contentType: c.content_type,
        blockCount: c.block_count,
        coverImageUrl: c.cover_image_url,
        creatorHandle: c.creator_handle,
        creatorName: c.creator_name,
        publishedAt: (c.published_at ?? c.created_at).toISOString(),
        url: `/read/${c.slug}`,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
