import { NextResponse } from "next/server";
import { getContent, getCreator } from "@/lib/store";
import { sliceLines, formatUsdc } from "@linepay/sdk";

/**
 * Reader-facing metadata + free preview for one piece (no full body).
 * Used by the reader page to render the article view with a paywall after the
 * free lines.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const content = getContent(id);
  if (!content) return NextResponse.json({ error: "content_not_found" }, { status: 404 });
  const creator = getCreator(content.creator_id);
  if (!creator) return NextResponse.json({ error: "creator_not_found" }, { status: 404 });

  const preview = sliceLines(content.body, 1, content.free_lines);
  return NextResponse.json({
    id: content.id,
    kind: content.kind,
    title: content.title,
    summary: content.summary,
    tags: content.tags ? content.tags.split(",").filter(Boolean) : [],
    creator: creator.handle,
    verified: !!creator.verified,
    lineCount: content.line_count,
    freeLines: content.free_lines,
    pricePerLine: content.price_per_line,
    pricePerLineDisplay: formatUsdc(content.price_per_line),
    series: content.series,
    chapterNo: content.chapter_no,
    preview: preview.text,
  });
}
