import { NextRequest } from "next/server";
import {
  assertNotImpersonating,
  errorResponse,
  resolveActingUser,
} from "@/lib/session";
import {
  createContent,
  creatorPublishedCount,
  getOrCreateVerifyCode,
  listContentByCreator,
  recordAdminEvent,
} from "@/lib/store";
import { chunkContent } from "@/lib/chunk-content";
import { normalizeUsdc } from "@/lib/money";
import { notifyFirstPublish } from "@/lib/email";
import { detectPlatform, verifyOwnership } from "@/lib/ownership";
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
      pricePerBlock?: string | number;
      summary?: string;
      tags?: string;
      status?: "draft" | "published";
      sourceUrl?: string;
    };

    if (!body.title?.trim()) return Response.json({ error: "missing_title" }, { status: 400 });
    if (!body.body?.trim()) return Response.json({ error: "missing_body" }, { status: 400 });
    const contentType: ContentType =
      body.contentType === "agent-skills" ? "agent-skills" : body.contentType === "x-post" ? "x-post" : "article";

    let pricePerBlock: string;
    try {
      pricePerBlock = normalizeUsdc(body.pricePerBlock ?? "0");
    } catch {
      return Response.json({ error: "invalid_price" }, { status: 400 });
    }

    const format = contentType === "agent-skills" ? "markdown" : "article";
    const chunks = chunkContent({ content: body.body, format });
    if (chunks.length === 0) return Response.json({ error: "no_chunks", message: "Content produced no blocks." }, { status: 400 });

    // article: chunk 0 is the free preview (block_index 0), rest payable (1..N).
    // agent-skills: block 0 is generated; store creator blocks at 1..N.
    const toStore =
      contentType === "agent-skills"
        ? chunks.map((c) => ({ text: c.text, isFree: false }))
        : chunks.map((c, i) => ({ text: c.text, isFree: i === 0 }));
    const firstBlockIndex = contentType === "agent-skills" ? 1 : 0;

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

    const isFirstPublish = status === "published" && (await creatorPublishedCount(user.id)) === 0;

    // Ownership verification: if this piece was imported, RE-VERIFY server-side
    // (never trust a client flag) and record the verdict on the content.
    let sourceUrl: string | null = null;
    let sourcePlatform: string | null = null;
    let ownershipVerified = false;
    let verifiedVia: string | null = null;
    if (body.sourceUrl && typeof body.sourceUrl === "string") {
      sourceUrl = body.sourceUrl;
      sourcePlatform = detectPlatform(sourceUrl).platform;
      try {
        const verifyCode = await getOrCreateVerifyCode(user.id);
        const v = await verifyOwnership({ url: sourceUrl, githubUsername: user.github_username, verifyCode });
        ownershipVerified = v.verified;
        verifiedVia = v.via;
      } catch {
        /* verification best-effort — publish proceeds unverified */
      }
    }

    const content = await createContent({
      creatorId: user.id,
      slug: slugify(body.title),
      title: body.title.trim(),
      summary: body.summary ?? "",
      tags: body.tags ?? "",
      contentType,
      body: body.body,
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
      if (isFirstPublish && user.email) {
        notifyFirstPublish({ to: user.email, name: user.display_name ?? undefined, title: content.title, readerUrl, agentUrl });
      }
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
