import { NextRequest } from "next/server";
import { errorResponse, requireUser } from "@/lib/session";
import { getFollowingFeed, getSuggestedCreators } from "@/lib/store";
import { publicName } from "@/lib/creator-posts";
import type { ContentWithCreator } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Map a feed row to the timeline post card shape (mirrors the marketplace shape). */
function serializeFeedRow(c: ContentWithCreator) {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    summary: c.summary,
    contentType: c.content_type,
    pricePerBlock: c.price_per_block,
    blockCount: c.block_count,
    coverImageUrl: c.cover_image_url,
    creatorId: c.creator_id,
    creatorHandle: c.creator_handle,
    creatorName: c.creator_name,
    creatorAvatar: c.creator_avatar,
    creatorVerified: c.creator_verified,
    publishedAt: (c.published_at ?? c.created_at).toISOString(),
    url: `/read/${c.slug}`,
  };
}

/**
 * GET /api/follows/feed?page=1&limit=20 — the current user's strictly
 * chronological following feed. When it's empty on the first page (you follow
 * nobody, or those you follow haven't published), include up to 5 suggested
 * creators to follow so the UI never renders a blank page.
 */
export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    const sp = req.nextUrl.searchParams;
    const page = Math.max(Number(sp.get("page")) || 1, 1);
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 20, 1), 50);

    const rows = await getFollowingFeed(me.id, page, limit);
    const posts = rows.map(serializeFeedRow);

    const payload: {
      posts: ReturnType<typeof serializeFeedRow>[];
      pagination: { page: number; limit: number; hasMore: boolean };
      suggestions?: { id: string; name: string; handle: string | null; avatarUrl: string | null }[];
    } = {
      posts,
      pagination: { page, limit, hasMore: rows.length === limit },
    };

    if (page === 1 && posts.length === 0) {
      const suggested = await getSuggestedCreators(me.id, 5);
      payload.suggestions = suggested.map((s) => ({
        id: s.id,
        name: publicName(s),
        handle: s.handle,
        avatarUrl: s.avatar,
      }));
    }

    return Response.json(payload);
  } catch (e) {
    return errorResponse(e);
  }
}
