import { NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/session";
import { chunkContent } from "@/lib/chunk-content";
import { previewSplit } from "@/lib/split-payment";
import { buildBlock0 } from "@/lib/agent-skills";
import { normalizeUsdc } from "@/lib/money";
import type { ContentType } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST — preview how content will split into payable blocks + the commission
 * split, before publishing. For agent-skills, also returns the generated
 * block-0 onboarding template (the creator never writes it by hand).
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const b = (await req.json().catch(() => ({}))) as {
      body?: string;
      contentType?: ContentType;
      pricePerBlock?: string | number;
      title?: string;
      summary?: string;
      hasReferrer?: boolean;
    };
    const contentType: ContentType = b.contentType === "agent-skills" ? "agent-skills" : "article";
    const format = contentType === "agent-skills" ? "markdown" : "article";
    const chunks = chunkContent({ content: b.body ?? "", format });
    // The price arrives live as the user types, so it can be mid-edit ("", "0.",
    // ".5"). normalizeUsdc throws on those — treat anything unparseable as 0 so
    // the preview never 500s (real validation happens on publish).
    let price: string;
    try {
      price = normalizeUsdc(b.pricePerBlock ?? "0");
    } catch {
      price = "0";
    }

    const payableCount = contentType === "agent-skills" ? chunks.length : Math.max(0, chunks.length - 1);
    const split = previewSplit(price, b.hasReferrer ?? false);

    let block0Template: string | undefined;
    if (contentType === "agent-skills") {
      block0Template = buildBlock0({
        title: b.title ?? "Untitled",
        slug: "{slug}",
        summary: b.summary ?? "",
        creatorHandle: "you",
        pricePerBlock: price,
        gatewayAddress:
          process.env.CIRCLE_GATEWAY_ADDRESS ||
          process.env.GATEWAY_WALLET_ADDRESS ||
          "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        payableBlocks: payableCount,
        baseUrl: (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, ""),
      });
    }

    return Response.json({
      blocks: chunks.map((c) => ({ index: c.index, preview: c.text.slice(0, 280), length: c.text.length })),
      payableBlocks: payableCount,
      split,
      block0Template,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
