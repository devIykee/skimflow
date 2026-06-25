import { NextRequest } from "next/server";
import { getUserById, listPublishedByCreator } from "@/lib/store";
import { serializePosts, toPublicCreator } from "@/lib/creator-posts";
import { renderCreatorFeed } from "@/lib/rss";
import { cacheGet, cacheSet } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_SEC = 300; // 5 minutes
const RSS_TYPE = "application/rss+xml; charset=utf-8";

/**
 * GET /api/creators/:creatorId/feed.xml — valid RSS 2.0 for a creator.
 * Free posts carry full content; paid posts carry the teaser only plus a
 * "Read the full post on Skimflow" link. No paid block content is ever emitted
 * (see lib/creator-posts.ts). Cached 5 minutes.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ creatorId: string }> }) {
  const { creatorId } = await ctx.params;
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 20, 1), 100);

  const cacheKey = `creator-feed:${creatorId}:${limit}`;
  const cached = await cacheGet<string>(cacheKey);
  if (cached) {
    return new Response(cached, { headers: { "Content-Type": RSS_TYPE, "Cache-Control": "public, max-age=300", "X-Cache": "HIT" } });
  }

  const creator = await getUserById(creatorId);
  if (!creator || creator.role === "admin" || creator.suspended) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const rows = await listPublishedByCreator(creatorId, { limit });
  const posts = await serializePosts(rows);
  const xml = renderCreatorFeed(toPublicCreator(creator), posts);

  await cacheSet(cacheKey, xml, CACHE_TTL_SEC);
  return new Response(xml, { headers: { "Content-Type": RSS_TYPE, "Cache-Control": "public, max-age=300", "X-Cache": "MISS" } });
}
