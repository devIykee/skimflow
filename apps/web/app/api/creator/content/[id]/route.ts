import { NextRequest } from "next/server";
import { assertNotImpersonating, errorResponse, resolveActingUser } from "@/lib/session";
import { deleteContent, getContentById, updateContent } from "@/lib/store";
import { chunkContent } from "@/lib/chunk-content";
import { normalizeUsdc } from "@/lib/money";
import type { ContentStatus, ContentType } from "@/lib/types";

export const runtime = "nodejs";

async function ownOr404(id: string, userId: string) {
  const content = await getContentById(id);
  if (!content || content.creator_id !== userId) return null;
  return content;
}

/** PATCH — edit metadata / price / status, optionally re-chunk on body change. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveActingUser();
    assertNotImpersonating(actor);
    const { id } = await ctx.params;
    const content = await ownOr404(id, actor.user.id);
    if (!content) return Response.json({ error: "not_found" }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      summary?: string;
      tags?: string;
      pricePerBlock?: string | number;
      body?: string;
      status?: ContentStatus;
    };

    // Wallet gate (same as create): can't move a draft to published without a
    // payout wallet. Block here too so the table's Publish toggle can't bypass it.
    if (body.status === "published") {
      const hasWallet = !!actor.user.wallet_address || !!actor.user.embedded_wallet_address;
      if (!hasWallet) {
        return Response.json(
          {
            error: "wallet_required",
            walletRequired: true,
            message: "Create a payout wallet before publishing — your draft is safe.",
          },
          { status: 422 }
        );
      }
    }

    let rechunk;
    if (body.body?.trim()) {
      const contentType = content.content_type as ContentType;
      const format = contentType === "agent-skills" ? "markdown" : "article";
      const chunks = chunkContent({ content: body.body, format });
      const toStore =
        contentType === "agent-skills"
          ? chunks.map((c) => ({ text: c.text, isFree: false }))
          : chunks.map((c, i) => ({ text: c.text, isFree: i === 0 }));
      rechunk = { chunks: toStore, firstBlockIndex: contentType === "agent-skills" ? 1 : 0 };
    }

    const updated = await updateContent(
      id,
      {
        title: body.title,
        summary: body.summary,
        tags: body.tags,
        pricePerBlock: body.pricePerBlock != null ? normalizeUsdc(body.pricePerBlock) : undefined,
        body: body.body,
        status: body.status,
      },
      rechunk
    );
    return Response.json({ ok: true, content: updated });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE — remove the creator's own content. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveActingUser();
    assertNotImpersonating(actor);
    const { id } = await ctx.params;
    const content = await ownOr404(id, actor.user.id);
    if (!content) return Response.json({ error: "not_found" }, { status: 404 });
    await deleteContent(id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
