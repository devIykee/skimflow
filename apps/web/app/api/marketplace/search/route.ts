import { NextRequest } from "next/server";
import { searchContent } from "@/lib/store";
import { envLimit, rateLimit, rateLimitResponse, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * GET /api/marketplace/search?q=...
 * Ranked Postgres full-text search over published content. Returns ranked
 * results with a highlighted (<mark>) excerpt.
 */
export async function GET(req: NextRequest) {
  const ip = clientIp(req.headers);
  const rl = await rateLimit({ key: `search:${ip}`, limit: envLimit("RATE_LIMIT_SEARCH", 30), windowSec: 60 });
  if (!rl.ok) return rateLimitResponse(rl);

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return Response.json({ query: "", results: [] });

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 30, 100);
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset")) || 0);

  const rows = await searchContent(q, limit, offset);
  return Response.json({
    query: q,
    count: rows.length,
    results: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      contentType: r.content_type,
      pricePerBlock: r.price_per_block,
      creatorId: r.creator_id,
      creatorHandle: r.creator_handle,
      creatorName: r.creator_name,
      rank: r.rank,
      excerpt: r.excerpt,
      url: `/read/${r.slug}`,
    })),
  });
}
