import { NextRequest } from "next/server";
import { assertNotImpersonating, errorResponse, resolveActingUser } from "@/lib/session";
import { deleteContent, getContentById, getChunks, updateContent, countPaidReaders, createReport } from "@/lib/store";
import { chunkContent } from "@/lib/chunk-content";
import { normalizeUsdc } from "@/lib/money";
import type { ContentStatus, ContentType } from "@/lib/types";

export const runtime = "nodejs";

// §5d: once content has been paid for it's protected against creator removal /
// substantive edit. Past this many distinct paid readers it hard-locks and only
// an admin can remove it; below it, removal needs explicit confirmation and
// leaves a report-trail.
const LOCK_THRESHOLD = 1000;

async function ownOr404(id: string, userId: string) {
  const content = await getContentById(id);
  if (!content || content.creator_id !== userId) return null;
  return content;
}

/** GET — load the creator's own content (incl. body / image links) into the
 *  editor for editing. Owner-only; mirrors the ownOr404 guard. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveActingUser();
    const { id } = await ctx.params;
    const content = await ownOr404(id, actor.user.id);
    if (!content) return Response.json({ error: "not_found" }, { status: 404 });

    // Picture posts store each image URL as a chunk's text (caption alongside);
    // hand those back as an ordered {url, caption}[] so the editor can repopulate.
    let images: Array<{ url: string; caption: string }> | undefined;
    if (content.content_type === "picture") {
      const chunks = await getChunks(content.id);
      images = chunks.map((c) => ({ url: c.image_url ?? c.text, caption: c.caption ?? "" }));
    }

    return Response.json({
      content: {
        id: content.id,
        title: content.title,
        slug: content.slug,
        summary: content.summary,
        tags: content.tags,
        content_type: content.content_type,
        price_per_block: content.price_per_block,
        status: content.status,
        body: content.body,
      },
      images,
    });
  } catch (e) {
    return errorResponse(e);
  }
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

    // Re-chunking replaces the stored chunks — a substantive edit. Guard it the
    // same way as deletion once readers have paid (§5d).
    if (body.body?.trim()) {
      const paid = await countPaidReaders(content.id);
      if (paid >= LOCK_THRESHOLD) {
        return Response.json(
          { error: "locked_admin_only", message: `This content has ${paid} paid readers and can only be changed by an admin.` },
          { status: 403 }
        );
      }
      if (paid > 0 && req.nextUrl.searchParams.get("confirm") !== "1") {
        return Response.json(
          { error: "needs_confirm", needsConfirm: true, paid, message: `${paid} reader(s) have paid for this content.` },
          { status: 409 }
        );
      }
      if (paid > 0) {
        await createReport({
          reportType: "content_report",
          reason: "creator_removed_paid",
          contentId: content.id,
          creatorId: content.creator_id,
          detail: `Creator substantively edited content with ${paid} paid reader(s).`,
        });
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

/** DELETE — remove the creator's own content (subject to the §5d paid-content lock). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveActingUser();
    assertNotImpersonating(actor);
    const { id } = await ctx.params;
    const content = await ownOr404(id, actor.user.id);
    if (!content) return Response.json({ error: "not_found" }, { status: 404 });

    const paid = await countPaidReaders(content.id);
    if (paid >= LOCK_THRESHOLD) {
      return Response.json(
        { error: "locked_admin_only", message: `This content has ${paid} paid readers and can only be removed by an admin.` },
        { status: 403 }
      );
    }
    if (paid > 0 && req.nextUrl.searchParams.get("confirm") !== "1") {
      return Response.json(
        { error: "needs_confirm", needsConfirm: true, paid, message: `${paid} reader(s) have paid for this content.` },
        { status: 409 }
      );
    }
    if (paid > 0) {
      // Removing paid content is allowed but recorded for review (§5d).
      await createReport({
        reportType: "content_report",
        reason: "creator_removed_paid",
        contentId: content.id,
        creatorId: content.creator_id,
        detail: `Creator removed content with ${paid} paid reader(s).`,
      });
    }

    await deleteContent(id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
