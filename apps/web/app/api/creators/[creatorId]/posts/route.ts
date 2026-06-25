import { NextRequest } from "next/server";
import { getUserById, listPublishedByCreator, countPublishedByCreator } from "@/lib/store";
import { serializePosts, toPublicCreator } from "@/lib/creator-posts";
import { cacheGet, cacheSet } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // we cache explicitly with our own TTL

const CACHE_TTL_SEC = 300; // 5 minutes

/**
 * GET /api/creators/:creatorId/posts — public, no auth. Lists a creator's
 * PUBLISHED posts, newest first, with paid content gated to a teaser. This is
 * the data source for the RSS feed and any future public API use.
 *
 * Query: ?page (1-based, default 1), ?limit (default 20, max 100).
 *
 * Paid posts NEVER include paid block text — see lib/creator-posts.ts. Cached
 * for 5 minutes per (creator, page, limit).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ creatorId: string }> }) {
  const { creatorId } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 20, 1), 100);
  const offset = (page - 1) * limit;

  const cacheKey = `creator-posts:${creatorId}:${page}:${limit}`;
  const cached = await cacheGet<object>(cacheKey);
  if (cached) {
    return Response.json(cached, { headers: { "Cache-Control": "public, max-age=300", "X-Cache": "HIT" } });
  }

  const creator = await getUserById(creatorId);
  if (!creator || creator.role === "admin") {
    // Admins aren't public creators; unknown id → 404.
    return Response.json({ error: "creator_not_found" }, { status: 404 });
  }
  if (creator.suspended) {
    return Response.json({ error: "creator_unavailable" }, { status: 404 });
  }

  const [rows, total] = await Promise.all([
    listPublishedByCreator(creatorId, { limit, offset }),
    countPublishedByCreator(creatorId),
  ]);
  const posts = await serializePosts(rows);

  const payload = {
    creator: toPublicCreator(creator),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore: offset + rows.length < total,
    },
    posts,
  };

  await cacheSet(cacheKey, payload, CACHE_TTL_SEC);
  return Response.json(payload, { headers: { "Cache-Control": "public, max-age=300", "X-Cache": "MISS" } });
}
