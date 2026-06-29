import { NextRequest } from "next/server";
import {
  assertNotImpersonating,
  errorResponse,
  resolveActingUser,
} from "@/lib/session";
import {
  createBook,
  createContent,
  listContentByCreator,
  recordAdminEvent,
} from "@/lib/store";
import { chunkContent, splitPages } from "@/lib/chunk-content";
import { validateArticleChunks, hasBlockingErrors } from "@/lib/chunk-validate";
import { normalizeImageUrl, isLikelyImageUrl, MAX_SKIMFLOW_IMAGES, MAX_CAPTION_CHARS } from "@/lib/image-links";
import { normalizeUsdc } from "@/lib/money";
import { detectPlatform } from "@/lib/ownership";
import type { ContentType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "untitled";
  return `${base}-${process.hrtime.bigint().toString(36).slice(-5)}`;
}

function appUrl(req: NextRequest): string {
  return (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
}

/** GET — list the acting creator's content (supports admin impersonation view). */
export async function GET() {
  try {
    const ctx = await resolveActingUser();
    const content = await listContentByCreator(ctx.user.id);
    return Response.json({ content, impersonating: ctx.impersonating });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST — create content (draft or published), chunking the body server-side. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveActingUser();
    assertNotImpersonating(ctx); // publishing is disabled while impersonating
    const user = ctx.user;

    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      contentType?: ContentType;
      body?: string;
      images?: Array<{ url?: string; caption?: string }>;
      /** Book (content_type='book') fields. */
      coverImageUrl?: string;
      chapters?: Array<{ title?: string; body?: string }>;
      pricePerBlock?: string | number;
      summary?: string;
      tags?: string;
      status?: "draft" | "published";
      sourceUrl?: string;
    };

    if (!body.title?.trim()) return Response.json({ error: "missing_title" }, { status: 400 });
    const contentType: ContentType =
      body.contentType === "agent-skills"
        ? "agent-skills"
        : body.contentType === "picture"
          ? "picture"
          : body.contentType === "book"
            ? "book"
            : "article";

    let pricePerBlock: string;
    try {
      pricePerBlock = normalizeUsdc(body.pricePerBlock ?? "0");
    } catch {
      return Response.json({ error: "invalid_price" }, { status: 400 });
    }

    const gatewayAddressDefault =
      process.env.CIRCLE_GATEWAY_ADDRESS ||
      process.env.GATEWAY_WALLET_ADDRESS ||
      "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

    // ── Books: parent content row + chapters + pages-as-chunks ──────────────────
    if (contentType === "book") {
      const coverImageUrl = body.coverImageUrl ? normalizeImageUrl(String(body.coverImageUrl)) : null;
      if (coverImageUrl && !isLikelyImageUrl(coverImageUrl))
        return Response.json({ error: "invalid_cover", message: "The cover image link isn't a valid URL." }, { status: 400 });

      const rawChapters = Array.isArray(body.chapters) ? body.chapters : [];
      const chapters = rawChapters
        .map((ch, i) => ({ title: String(ch.title ?? `Chapter ${i + 1}`).slice(0, 200), pages: splitPages(String(ch.body ?? "")) }))
        .filter((ch) => ch.pages.length > 0);
      if (chapters.length === 0)
        return Response.json({ error: "no_chapters", message: "Add at least one chapter with some text." }, { status: 400 });
      const totalPages = chapters.reduce((n, ch) => n + ch.pages.length, 0);
      if (totalPages < 2)
        return Response.json(
          { error: "too_short", message: "A book needs at least 2 pages — the first is a free preview. Add more text or a `---` page break." },
          { status: 400 }
        );

      const requestedStatus = body.status === "published" ? "published" : "draft";
      const hasWallet = !!user.wallet_address || !!user.embedded_wallet_address;
      const walletGated = requestedStatus === "published" && !hasWallet;
      const status = walletGated ? "draft" : requestedStatus;

      const content = await createBook({
        creatorId: user.id,
        slug: slugify(body.title),
        title: body.title.trim(),
        description: body.summary ?? "",
        coverImageUrl,
        pricePerBlock,
        gatewayAddress: gatewayAddressDefault,
        tags: body.tags ?? "",
        status,
        chapters,
      });

      const readerUrl = `${appUrl(req)}/read/${content.slug}`;
      if (status === "published") {
        await recordAdminEvent({
          eventType: "PUBLISH",
          actorId: user.id,
          contentId: content.id,
          metadata: { title: content.title, slug: content.slug, type: "book" },
        });
      }
      if (walletGated)
        return Response.json(
          { content, readerUrl, walletRequired: true, draftSaved: true, contentId: content.id, message: "Saved to drafts — create a payout wallet to publish and start earning." },
          { status: 200 }
        );
      return Response.json({ content, readerUrl });
    }

    // Build the chunks to store, per content type.
    let toStore: Array<{ text: string; isFree: boolean; imageUrl?: string | null; caption?: string | null }>;
    let firstBlockIndex: number;
    let storedBody: string;

    if (contentType === "picture") {
      // Picture Skim-Flow: each image is a chunk (block 0 = free preview image).
      const images = Array.isArray(body.images) ? body.images : [];
      if (images.length === 0) return Response.json({ error: "no_images", message: "Add at least one image." }, { status: 400 });
      if (images.length > MAX_SKIMFLOW_IMAGES)
        return Response.json({ error: "too_many_images", message: `Maximum ${MAX_SKIMFLOW_IMAGES} images per post.` }, { status: 400 });

      // Store the (gated) image URL in `text` so the existing unlock path —
      // which returns chunk `text` after payment — delivers the image link; the
      // caption rides along in its own column as an always-visible label.
      toStore = images.map((im, i) => {
        const url = normalizeImageUrl(String(im.url ?? ""));
        const caption = String(im.caption ?? "").slice(0, MAX_CAPTION_CHARS);
        return { text: url, isFree: i === 0, imageUrl: url, caption };
      });
      if (toStore.some((c) => !c.imageUrl || !isLikelyImageUrl(c.imageUrl)))
        return Response.json({ error: "invalid_image", message: "One of the image links isn't a valid URL." }, { status: 400 });
      firstBlockIndex = 0;
      storedBody = ""; // body is unused for picture posts
    } else {
      if (!body.body?.trim()) return Response.json({ error: "missing_body" }, { status: 400 });
      const format = contentType === "agent-skills" ? "markdown" : "article";
      const chunks = chunkContent({ content: body.body, format });
      if (chunks.length === 0) return Response.json({ error: "no_chunks", message: "Content produced no blocks." }, { status: 400 });

      // Chunk-limit validation (article only). Block PUBLISH on errors so an
      // abusive or malformed split can't go live; drafts are always saveable so
      // work is never lost mid-edit.
      if (contentType === "article" && body.status === "published") {
        const results = validateArticleChunks(chunks.map((c) => c.text));
        if (hasBlockingErrors(results)) {
          return Response.json(
            {
              error: "chunk_validation",
              message: "Some chunks don't meet the limits. Fix them or use Auto-chunk, then publish.",
              chunks: results.filter((r) => r.errors.length > 0),
            },
            { status: 400 }
          );
        }
      }

      // article: chunk 0 is the free preview (block_index 0), rest payable (1..N).
      // agent-skills: block 0 is generated; store creator blocks at 1..N.
      toStore =
        contentType === "agent-skills"
          ? chunks.map((c) => ({ text: c.text, isFree: false }))
          : chunks.map((c, i) => ({ text: c.text, isFree: i === 0 }));
      firstBlockIndex = contentType === "agent-skills" ? 1 : 0;
      storedBody = body.body;
    }

    const gatewayAddress =
      process.env.CIRCLE_GATEWAY_ADDRESS ||
      process.env.GATEWAY_WALLET_ADDRESS ||
      "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

    const requestedStatus = body.status === "published" ? "published" : "draft";

    // Wallet gate: you can't publish (and start earning) without a payout
    // wallet. Rather than reject and lose the work, downgrade to a draft and
    // tell the client so it can prompt wallet creation, then re-publish.
    const hasWallet = !!user.wallet_address || !!user.embedded_wallet_address;
    const walletGated = requestedStatus === "published" && !hasWallet;
    const status = walletGated ? "draft" : requestedStatus;

    // Import provenance only. Ownership verification was removed to keep
    // publishing seamless — we still record the source URL + platform for
    // attribution, but never block or gate on a verification step.
    let sourceUrl: string | null = null;
    let sourcePlatform: string | null = null;
    const ownershipVerified = false;
    const verifiedVia: string | null = null;
    if (body.sourceUrl && typeof body.sourceUrl === "string") {
      sourceUrl = body.sourceUrl;
      sourcePlatform = detectPlatform(sourceUrl).platform;
    }

    const content = await createContent({
      creatorId: user.id,
      slug: slugify(body.title),
      title: body.title.trim(),
      summary: body.summary ?? "",
      tags: body.tags ?? "",
      contentType,
      body: storedBody,
      pricePerBlock,
      gatewayAddress,
      chunks: toStore,
      firstBlockIndex,
      status,
      sourceUrl,
      sourcePlatform,
      ownershipVerified,
      verifiedVia,
    });

    const base = appUrl(req);
    const readerUrl = `${base}/read/${content.slug}`;
    const agentUrl = contentType === "agent-skills" ? `${base}/read/${content.slug}/agent-skills.md` : undefined;

    if (status === "published") {
      await recordAdminEvent({
        eventType: "PUBLISH",
        actorId: user.id,
        contentId: content.id,
        metadata: { title: content.title, slug: content.slug, type: contentType },
      });
    }

    if (walletGated) {
      // Saved as a draft instead of published — surface that clearly so the UI
      // can route the creator into wallet creation and offer to publish after.
      return Response.json(
        {
          content,
          readerUrl,
          agentUrl,
          walletRequired: true,
          draftSaved: true,
          contentId: content.id,
          message: "Saved to drafts — create a payout wallet to publish and start earning.",
        },
        { status: 200 }
      );
    }

    return Response.json({ content, readerUrl, agentUrl });
  } catch (e) {
    return errorResponse(e);
  }
}
