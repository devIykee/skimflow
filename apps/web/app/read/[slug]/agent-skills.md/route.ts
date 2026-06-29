import { NextRequest } from "next/server";
import {
  bumpCounter,
  getChunk,
  getContentWithCreator,
  getLedgerByToken,
  getUserById,
  insertLedger,
} from "@/lib/store";
import { buildBlock0, gatewayAddressFor } from "@/lib/agent-skills";
import {
  deriveAgentIdentity,
  ensureAgentSession,
  record402Hit,
  recordAgentUnlock,
} from "@/lib/agent-session";
import { withGateway } from "@/lib/x402-gateway";
import { validateWallet } from "@/lib/validate-wallet";
import { splitPayment } from "@/lib/split-payment";
import { getReferrerId, persistReferral } from "@/lib/referral";
import type { Address } from "viem";
import {
  envLimit,
  rateLimit,
  rateLimitHeaders,
  rateLimitResponse,
  clientIp,
  type RateResult,
} from "@/lib/rate-limit";
export const runtime = "nodejs";

const MARKDOWN = "text/markdown; charset=utf-8";

function markdown(body: string, status: number, rl: RateResult, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": MARKDOWN, ...rateLimitHeaders(rl), ...extra },
  });
}
function json(body: unknown, status: number, rl: RateResult): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...rateLimitHeaders(rl) },
  });
}

/**
 * GET /read/:slug/agent-skills.md[?block=N]
 *
 *  - block 0 (or omitted): the free, auto-generated onboarding block.
 *  - block N≥1 without X-Payment-Token: HTTP 402 + payment instructions.
 *  - block N≥1 with X-Payment-Token: optimistic serve + ledger row
 *    (pending in live mode → finalized by the Circle webhook; completed
 *    immediately in simulate mode).
 *
 * Rate limited (trusted agents get 5×). Every response carries X-RateLimit-*.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const blockParam = req.nextUrl.searchParams.get("block");
  const blockIndex = blockParam == null ? 0 : Math.max(0, parseInt(blockParam, 10) || 0);

  const content = await getContentWithCreator(slug);
  if (!content) {
    return new Response(JSON.stringify({ error: "content_not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Suspended content returns 403 for ALL blocks, including block 0.
  if (content.status === "suspended") {
    return new Response(
      JSON.stringify({ error: "Content suspended", reason: content.suspended_reason ?? null }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }
  if (content.status !== "published") {
    return new Response(JSON.stringify({ error: "content_not_available" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Agent identity + session (upsert).
  const id = deriveAgentIdentity(req.headers);
  const session = await ensureAgentSession(id);
  if (session.blocked) {
    return new Response(JSON.stringify({ error: "agent_blocked" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Rate limit (before any business logic). Trusted agents get 5×.
  const baseLimit = envLimit("RATE_LIMIT_AGENT_READ", 60);
  const limit = session.trusted ? baseLimit * 5 : baseLimit;
  const rl = await rateLimit({ key: `agentread:${clientIp(req.headers)}`, limit, windowSec: 60 });
  if (!rl.ok) return rateLimitResponse(rl);

  const gateway = gatewayAddressFor(content);
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");

  // ── Block 0: free onboarding ───────────────────────────────────────────────
  if (blockIndex === 0) {
    void bumpCounter("block0_fetch");
    const md = buildBlock0({
      title: content.title,
      slug: content.slug,
      summary: content.summary,
      creatorHandle: content.creator_handle,
      pricePerBlock: content.price_per_block,
      gatewayAddress: gateway,
      payableBlocks: content.block_count,
      baseUrl,
    });
    const res = markdown(md, 200, rl, { "X-Free-Block": "0" });
    persistReferral(req, res);
    return res;
  }

  // ── Block N≥1: gated ───────────────────────────────────────────────────────
  const chunk = await getChunk(content.id, blockIndex);
  if (!chunk) return json({ error: "block_not_found", block_index: blockIndex }, 404, rl);

  const simulate = (process.env.PAYMENTS_MODE ?? "simulate").toLowerCase() !== "live";
  const xPayment = req.headers.get("x-payment");
  const token = req.headers.get("x-payment-token");

  // Shared: record an agent unlock on first credit for this payment.
  const serveBlock = async (
    paymentToken: string,
    payerId: string,
    txHash: string | null,
    status: "completed" | "pending"
  ): Promise<Response> => {
    let ledger = await getLedgerByToken(paymentToken);
    if (!ledger) {
      const referrerId = getReferrerId(req);
      const split = splitPayment({ total: content.price_per_block, hasReferrer: !!referrerId });
      ledger = await insertLedger({
        contentId: content.id,
        creatorId: content.creator_id,
        payerId,
        payerKind: "agent",
        blockIndex,
        grossAmount: split.gross,
        creatorAmount: split.creatorAmount,
        platformAmount: split.platformAmount,
        referrerAmount: split.referrerAmount,
        reserveAmount: split.reserveAmount,
        referrerId,
        paymentToken,
        txHash,
        status,
      });
      await recordAgentUnlock(id, content.id, blockIndex, split.gross);
    }
    const res = markdown(`<!-- block ${blockIndex} of ${content.title} -->\n\n${chunk.text}\n`, 200, rl, {
      "X-Payment-Status": ledger.status,
      "X-Block-Index": String(blockIndex),
    });
    persistReferral(req, res);
    return res;
  };

  // ── Legacy path: opaque X-Payment-Token (kept for back-compat) ─────────────
  // Only when the agent did NOT send a real x402 `X-Payment` authorization.
  if (token && !xPayment) {
    return serveBlock(token, id.payerId, null, simulate ? "completed" : "pending");
  }

  // ── x402 path: real signed USDC payment via Circle Gateway ─────────────────
  // payTo must be a real wallet. Resolve it the same way every other money path
  // does — the creator's external `wallet_address` first, then their Circle
  // embedded wallet — and if the creator has neither, route the payment to the
  // PLATFORM RESERVE rather than ever the dead/burn address.
  const creator = await getUserById(content.creator_id);
  let payTo = (validateWallet(creator?.wallet_address).checksummed ??
    validateWallet(creator?.embedded_wallet_address).checksummed ??
    null) as Address | null;
  if (!payTo) {
    const reserve = validateWallet(
      process.env.PLATFORM_ADDRESS || process.env.PLATFORM_WALLET_ADDRESS
    ).checksummed as Address | undefined;
    if (reserve) {
      console.warn(
        `[agent-skills] creator ${content.creator_id} (slug=${slug}) has no payout wallet — defaulting payTo to the platform reserve.`
      );
      payTo = reserve;
    }
  }
  if (!payTo) {
    // No creator wallet AND no platform reserve configured — genuine misconfig.
    console.error(`[agent-skills] no creator wallet and no PLATFORM_ADDRESS reserve (slug=${slug}) — refusing to quote.`);
    return json({ error: "payout_unconfigured", message: "No payout wallet is configured for this skill." }, 500, rl);
  }
  // Safety net: a dead/burn address must never appear in a payment quote.
  if (payTo.toLowerCase() === DEAD_ADDRESS.toLowerCase()) {
    console.error(`[agent-skills] dead address resolved as payTo for slug=${slug} — refusing to quote.`);
    return json({ error: "invalid_payout_wallet", message: "Payout wallet is invalid." }, 500, rl);
  }
  const resource = `${baseUrl}/read/${content.slug}/agent-skills.md?block=${blockIndex}`;

  if (!xPayment) await record402Hit(id, content.id, blockIndex);

  return withGateway(
    req,
    {
      price: content.price_per_block,
      payTo,
      resource,
      description: `Unlock block ${blockIndex} of "${content.title}" for ${content.price_per_block} USDC.`,
      blockIndex,
      extraHeaders: { ...rateLimitHeaders(rl), "X-Agent-Entrypoint": `${baseUrl}/deploy` },
    },
    // withGateway only invokes onPaid AFTER Circle confirms settlement, so the
    // payment is final here (live or simulate) — record it completed.
    (receipt) =>
      serveBlock(
        receipt.txHash,
        receipt.payer,
        receipt.simulated ? null : receipt.txHash,
        "completed"
      )
  );
}

// The dead/burn address — must NEVER appear as a payTo in a payment quote.
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;
