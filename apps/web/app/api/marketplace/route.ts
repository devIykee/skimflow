import { NextRequest } from "next/server";
import { listPublished } from "@/lib/store";
import type { ContentType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — public marketplace listing with filters. No auth required. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const rows = await listPublished({
    contentType: (sp.get("type") as ContentType | null) ?? undefined,
    minPrice: sp.get("minPrice") ?? undefined,
    maxPrice: sp.get("maxPrice") ?? undefined,
    sort: (sp.get("sort") as "newest" | "popular" | null) ?? undefined,
    limit: Number(sp.get("limit")) || 30,
    offset: Number(sp.get("offset")) || 0,
  });
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
      creatorHandle: r.creator_handle,
      creatorName: r.creator_name,
      creatorAvatar: r.creator_avatar,
      creatorVerified: r.creator_verified,
      ownershipVerified: r.ownership_verified,
      sourcePlatform: r.source_platform,
      url: `/read/${r.slug}`,
      agentUrl: r.content_type === "agent-skills" ? `/read/${r.slug}/agent-skills.md` : null,
    })),
  });
}
