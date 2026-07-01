import { NextRequest } from "next/server";
import { currentSession } from "@/lib/session";
import {
  followingIdsFor,
  getCommentCounts,
  getPostLikeCounts,
  likedPostIdsFor,
  listPublished,
} from "@/lib/store";
import type { ContentType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — public marketplace listing with filters. No auth required. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = (sp.get("type") as ContentType | null) ?? undefined;
  const rows = await listPublished({
    contentType: type,
    // The "All" feed (no type filter) mixes human content — articles + Skimflow
    // picture posts — but NOT books or agent skills. Books live only in their own
    // tab (their cover-grid card size doesn't fit the mixed feed layout).
    excludeTypes: type ? undefined : ["agent-skills", "book"],
    minPrice: sp.get("minPrice") ?? undefined,
    maxPrice: sp.get("maxPrice") ?? undefined,
    sort: (sp.get("sort") as "newest" | "popular" | null) ?? undefined,
    limit: Number(sp.get("limit")) || 30,
    offset: Number(sp.get("offset")) || 0,
  });

  // Engagement signals, batched. `liked`/`authorFollowing` only resolve for a
  // signed-in viewer.
  const ids = rows.map((r) => r.id);
  const creatorIds = [...new Set(rows.map((r) => r.creator_id))];
  const session = await currentSession();
  const uid = session?.user?.id ?? null;
  const [likeCounts, commentCounts, likedSet, followingSet] = await Promise.all([
    getPostLikeCounts(ids),
    getCommentCounts(ids),
    likedPostIdsFor(uid, ids),
    followingIdsFor(uid, creatorIds),
  ]);

  return Response.json({
    items: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      tags: r.tags,
      contentType: r.content_type,
      pricePerBlock: r.price_per_block,
      blockCount: r.block_count,
      coverImageUrl: r.cover_image_url,
      creatorHandle: r.creator_handle,
      creatorName: r.creator_name,
      creatorAvatar: r.creator_avatar,
      creatorVerified: r.creator_verified,
      ownershipVerified: r.ownership_verified,
      sourcePlatform: r.source_platform,
      url: `/read/${r.slug}`,
      agentUrl: r.content_type === "agent-skills" ? `/read/${r.slug}/agent-skills.md` : null,
      likeCount: likeCounts.get(r.id) ?? 0,
      commentCount: commentCounts.get(r.id) ?? 0,
      liked: likedSet.has(r.id),
      creatorId: r.creator_id,
      authorFollowing: followingSet.has(r.creator_id),
    })),
  });
}
