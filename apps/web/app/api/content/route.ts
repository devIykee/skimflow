import { NextRequest, NextResponse } from "next/server";
import { createContent, getCreatorByHandle, listContent } from "@/lib/store";
import { countLines, parseUsdc } from "@linepay/sdk";

export async function GET() {
  return NextResponse.json({ content: listContent() });
}

/**
 * Creator uploads / connects content. Body is Markdown; we compute the line
 * count and store the per-line price (entered in dollars, stored in base units).
 */
export async function POST(req: NextRequest) {
  const b = await req.json();
  const creator = getCreatorByHandle(String(b.creatorHandle ?? "").replace(/^@/, ""));
  if (!creator) return NextResponse.json({ error: "unknown creator handle" }, { status: 400 });
  if (!b.title || !b.body) return NextResponse.json({ error: "title and body required" }, { status: 400 });

  const pricePerLine =
    b.pricePerLine !== undefined
      ? parseUsdc(b.pricePerLine).toString()
      : parseUsdc(0.00005).toString(); // default $0.00005 / line

  const ALLOWED_KINDS = ["article", "novel_chapter", "agent-skill", "prompt-template", "knowledge-base"] as const;
  const kind = (ALLOWED_KINDS as readonly string[]).includes(b.kind) ? (b.kind as (typeof ALLOWED_KINDS)[number]) : "article";
  const content = createContent({
    creator_id: creator.id,
    kind,
    title: b.title,
    summary: b.summary ?? "",
    tags: Array.isArray(b.tags) ? b.tags.join(",") : b.tags ?? "",
    body: b.body,
    line_count: countLines(b.body),
    price_per_line: pricePerLine,
    free_lines: b.freeLines ?? 3,
    series: b.series ?? null,
    chapter_no: b.chapterNo ?? null,
  });
  return NextResponse.json({ content });
}
