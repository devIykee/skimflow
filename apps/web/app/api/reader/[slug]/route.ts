import { NextRequest, after } from "next/server";
import { cookies } from "next/headers";
import {
  chargePaySession,
  failLedgerByToken,
  finalizeLedgerByToken,
  getChunk,
  getChunks,
  getContentWithCreator,
  getLedgerByToken,
  getUserById,
  insertLedger,
  maxBlockIndex,
  payableChunkCount,
  recordAdminEvent,
  setLedgerAttestation,
  setLedgerMintTx,
} from "@/lib/store";
import { settlePendingByToken } from "@/lib/settle";
import { currentSession } from "@/lib/session";
import {
  arc,
  batchingRequirements,
  friendlyError,
  settleViaCircle,
  verifyDirectTransfer,
} from "@/lib/reader-pay";
import { splitPayment } from "@/lib/split-payment";
import { validateWallet } from "@/lib/validate-wallet";
import { getReferrerId } from "@/lib/referral";
import { toBaseUnits, toDecimal, wholePiecePrice } from "@/lib/money";
import { PAY_SESSION_COOKIE, verifyPaySession } from "@/lib/session-key";
import {
  ensureRevenueSplitApproval,
  relayMint,
  relayerRecipient,
  splitOnChain,
  submitBurnIntent,
  verifyBurnIntent,
} from "@/lib/gateway-relayer";
import type { WireBurnIntent } from "@/lib/burn-intent";
import type { Address, Hex } from "@skimflow/sdk";

export const runtime = "nodejs";

const BURN = "0x000000000000000000000000000000000000dEaD" as Address;

/**
 * POST /api/reader/:slug  — human chunk unlock via Circle Gateway on Arc.
 * Two-phase: quote (no signature) → settle (authorization+signature) OR a
 * direct USDC transfer (directTx). Writes a payment_ledger row (pending in
 * live mode → finalized by the Circle webhook; completed in simulate).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      blockIndex?: number;
      authorization?: { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex };
      signature?: Hex;
      directTx?: { hash: Hex; from?: Address };
      sessionPayment?: { burnIntent: WireBurnIntent; signature: Hex };
      /** Whole-piece purchase: pay the discounted lump sum and unlock every block. */
      whole?: boolean;
      /** §3 optimistic unlock: render this (non-final) block before settlement. */
      optimistic?: boolean;
      /** §3 combined check: the prior optimistic block's token to settle first. */
      priorToken?: string;
      /** Simulate-only test hook: force this block's payment to fail. */
      simulateFail?: boolean;
    };
    const blockIndex = Math.max(0, Number(body.blockIndex ?? 0));
    // Whole-piece requests carry no blockIndex, so it defaults to 0 — the always
    // -free first block. Detect it here so the free-block short-circuit below
    // doesn't swallow the whole-piece quote/settle (which prices every payable
    // block, not block 0).
    const wantsWhole = body.whole === true;

    const content = await getContentWithCreator(slug);
    if (!content) return Response.json({ error: "content_not_found", friendly: "This content no longer exists." }, { status: 404 });
    if (content.status === "suspended")
      return Response.json({ error: "Content suspended", reason: content.suspended_reason }, { status: 403 });
    if (content.status !== "published") return Response.json({ error: "content_not_available" }, { status: 404 });

    const chunk = await getChunk(content.id, blockIndex);
    // A single-block request must point at a real chunk. A whole-piece request
    // carries no block (it defaults to 0), and agent-skills start at block 1 — so
    // block 0 never exists there. Don't 404 the whole-piece flow on that absence;
    // it resolves every payable chunk further down instead.
    if (!wantsWhole) {
      if (!chunk) return Response.json({ error: "block_not_found" }, { status: 404 });
      if (chunk.is_free) return Response.json({ free: true, blockIndex, text: chunk.text });
    }

    // Creators (and admins) read their own work in full, free — they already own
    // it, so there's nothing to charge. This is the authoritative gate; the
    // reader UI also renders the owner's blocks directly, so it normally never
    // even reaches this route, but the bypass keeps the API honest either way.
    const viewer = await currentSession();
    if (viewer?.user?.id) {
      let isOwner = content.creator_id === viewer.user.id;
      if (!isOwner) {
        const vu = await getUserById(viewer.user.id);
        isOwner = vu?.role === "admin";
      }
      if (isOwner && chunk) return Response.json({ free: true, owner: true, blockIndex, text: chunk.text });
    }

    const creator = await getUserById(content.creator_id);
    const walletCheck = validateWallet(creator?.wallet_address);
    const payTo = walletCheck.checksummed ?? BURN;

    const amount = toBaseUnits(content.price_per_block).toString();
    const requirements = batchingRequirements(amount, payTo);
    const simulate = (process.env.PAYMENTS_MODE ?? "simulate").toLowerCase() !== "live";
    const optimisticEnabled = (process.env.OPTIMISTIC_UNLOCK_ENABLED ?? "false").toLowerCase() === "true";
    // The final chunk is never optimistic (spec §3.4) — it must confirm before render.
    const isFinal = blockIndex >= (await maxBlockIndex(content.id));

    // Whole-piece pricing is server-authoritative: the count + discount are read
    // from the DB here and recomputed identically on settle, so a tampered client
    // can never underpay (the burn intent value must equal `wholeAmount`).
    const wholeQuote = async () => {
      const count = await payableChunkCount(content.id);
      const decimal = wholePiecePrice(content.price_per_block, count);
      return { count, decimal, wei: toBaseUnits(decimal).toString() };
    };

    // ── Phase 1: quote ─────────────────────────────────────────────────────────
    if (!body.directTx && !body.sessionPayment && (!body.authorization || !body.signature)) {
      if (wantsWhole) {
        const w = await wholeQuote();
        return Response.json({
          needsPayment: true,
          whole: true,
          requirements: batchingRequirements(w.wei, payTo),
          blockIndex: 0,
          amount: w.wei,
          amountDisplay: w.decimal,
          chainId: arc.chainId,
          sessionRecipient: relayerRecipient(),
          count: w.count,
        });
      }
      return Response.json({
        needsPayment: true,
        requirements,
        blockIndex,
        amount,
        amountDisplay: toDecimal(amount),
        chainId: arc.chainId,
        // Recipient for the session-key (silent) path: the relayer mints + routes
        // to RevenueSplit on-chain. The browser builds its burn intent toward this.
        sessionRecipient: relayerRecipient(),
        // §3: tell the client whether to render this block optimistically. The
        // final chunk is excluded so the client confirms payment before showing it.
        optimistic: optimisticEnabled && !isFinal,
        isFinal,
      });
    }

    const referrerId = getReferrerId(req);
    const split = splitPayment({ total: content.price_per_block, hasReferrer: !!referrerId });

    const finalize = async (
      txHash: string,
      payer: Address,
      opts?: { paymentToken?: string; paySessionId?: string | null }
    ) => {
      const token = opts?.paymentToken ?? txHash;
      // Idempotent on the payment token (tx hash or burn-intent salt).
      const existing = await getLedgerByToken(token);
      if (existing) {
        return Response.json({ paid: true, alreadyUnlocked: true, blockIndex, text: chunk!.text, txHash });
      }
      await insertLedger({
        contentId: content.id,
        creatorId: content.creator_id,
        payerId: payer,
        payerKind: "human",
        blockIndex,
        grossAmount: split.gross,
        creatorAmount: split.creatorAmount,
        platformAmount: split.platformAmount,
        referrerAmount: split.referrerAmount,
        reserveAmount: split.reserveAmount,
        referrerId,
        paySessionId: opts?.paySessionId ?? null,
        paymentToken: token,
        txHash,
        status: simulate ? "completed" : "pending",
      });
      await recordAdminEvent({
        eventType: "UNLOCK",
        payerId: payer,
        contentId: content.id,
        blockIndex,
        amountGross: split.gross,
        metadata: { slug: content.slug },
      });
      return Response.json({
        paid: true,
        simulated: simulate,
        blockIndex,
        amount,
        amountDisplay: toDecimal(amount),
        txHash,
        text: chunk!.text,
      });
    };

    // ── Session-key (silent) path ───────────────────────────────────────────────
    if (body.sessionPayment) {
      const { burnIntent, signature } = body.sessionPayment;
      if (!burnIntent || !signature) return Response.json({ error: "missing_session_payment" }, { status: 400 });

      const cookie = (await cookies()).get(PAY_SESSION_COOKIE)?.value;
      const claims = cookie ? await verifyPaySession(cookie) : null;
      if (!claims)
        return Response.json({ error: "no_pay_session", friendly: "Set up silent payments first." }, { status: 401 });

      // ── Whole-piece purchase (one burn → unlock every payable block) ──────────
      if (wantsWhole) {
        const w = await wholeQuote();
        const wholeWei = BigInt(w.wei);
        const vcheck = await verifyBurnIntent(burnIntent, signature, {
          signer: claims.sessionAddress as Address,
          depositor: claims.mainWallet as Address,
          value: wholeWei, // server figure — under-paying burns are rejected here
        });
        if (!vcheck.ok)
          return Response.json({ error: "session_verify_failed", detail: vcheck.reason, friendly: "Couldn't verify the payment — please set up again." }, { status: 402 });

        const salt = burnIntent.spec.salt;
        const allTexts = async () => {
          const all = await getChunks(content.id);
          return Object.fromEntries(all.filter((c) => !c.is_free).map((c) => [c.block_index, c.text]));
        };
        const dup = await getLedgerByToken(salt);
        if (dup) return Response.json({ paid: true, whole: true, alreadyUnlocked: true, texts: await allTexts(), token: salt });

        const wholeSplit = splitPayment({ total: w.decimal, hasReferrer: !!referrerId });
        const wCharge = await chargePaySession(claims.sessionId, w.decimal);
        if (!wCharge.ok) {
          const friendly =
            wCharge.reason === "cap_exceeded"
              ? "You've reached your spend cap. Add funds to unlock the whole piece."
              : "Your payment session has ended — set it up again.";
          return Response.json({ error: wCharge.reason, friendly }, { status: 402 });
        }

        const insertWhole = (status: "pending" | "completed") =>
          insertLedger({
            contentId: content.id,
            creatorId: content.creator_id,
            payerId: claims.mainWallet as Address,
            payerKind: "human",
            blockIndex: 0, // whole-piece marker (metadata.whole disambiguates)
            grossAmount: wholeSplit.gross,
            creatorAmount: wholeSplit.creatorAmount,
            platformAmount: wholeSplit.platformAmount,
            referrerAmount: wholeSplit.referrerAmount,
            reserveAmount: wholeSplit.reserveAmount,
            referrerId,
            paySessionId: claims.sessionId,
            paymentToken: salt,
            txHash: null,
            status,
          });

        if (!simulate) {
          const creatorWallet = (walletCheck.checksummed ?? BURN) as Address;
          let referrerWallet: Address | null = null;
          if (referrerId) {
            const refUser = await getUserById(referrerId);
            referrerWallet = (validateWallet(refUser?.wallet_address).checksummed ?? null) as Address | null;
          }
          let burn: { attestation: Hex; signature: Hex };
          try {
            burn = await submitBurnIntent(burnIntent, signature);
          } catch (e) {
            await chargePaySession(claims.sessionId, `-${w.decimal}`).catch(() => undefined);
            const detail = String((e as Error)?.message ?? e);
            return Response.json({ error: "burn_failed", detail, friendly: friendlyError(detail) }, { status: 402 });
          }
          await insertWhole("pending");
          after(async () => {
            try {
              await setLedgerAttestation(salt, burn.attestation, burn.signature);
              await ensureRevenueSplitApproval();
              const mintTx = await relayMint(burn.attestation, burn.signature);
              await setLedgerMintTx(salt, mintTx);
              const splitTx = await splitOnChain(creatorWallet, referrerWallet, wholeWei);
              await finalizeLedgerByToken(salt, splitTx);
            } catch (err) {
              console.error("[reader whole settle]", String((err as Error)?.message ?? err));
            }
          });
        } else {
          await insertWhole("completed");
        }

        await recordAdminEvent({
          eventType: "UNLOCK",
          payerId: claims.mainWallet as Address,
          contentId: content.id,
          blockIndex: 0,
          amountGross: wholeSplit.gross,
          metadata: { slug: content.slug, whole: true },
        });

        return Response.json({ paid: true, whole: true, blocked: false, texts: await allTexts(), token: salt });
      }

      const amountWei = BigInt(amount);
      const check = await verifyBurnIntent(burnIntent, signature, {
        signer: claims.sessionAddress as Address,
        depositor: claims.mainWallet as Address,
        value: amountWei,
      });
      if (!check.ok)
        return Response.json({ error: "session_verify_failed", detail: check.reason, friendly: "Couldn't verify the silent payment — please set up again." }, { status: 402 });

      // Idempotency: the burn-intent salt is the payment token.
      const salt = burnIntent.spec.salt;
      const dup = await getLedgerByToken(salt);
      if (dup) return Response.json({ paid: true, alreadyUnlocked: true, blockIndex, text: chunk!.text, txHash: salt });

      // ── §3 Optimistic unlock (non-final blocks; flag on) ────────────────────
      // Render N now, settle in the background. The N+1 request carries
      // `priorToken`; we settle/verify the prior block first (the combined
      // check) and block this unlock if the prior payment failed.
      if (optimisticEnabled && body.optimistic && !isFinal) {
        if (body.priorToken) {
          const prior = await getLedgerByToken(body.priorToken);
          if (prior && prior.status === "failed") {
            return Response.json(
              { blocked: true, error: "prior_unsettled", friendly: "Your previous payment didn't go through. Retry or top up to continue." },
              { status: 402 }
            );
          }
          if (prior && prior.status === "pending") {
            if (simulate) {
              // Optimistic simulate rows already carry the per-chunk split — just finalize.
              await finalizeLedgerByToken(body.priorToken);
            } else if (prior.attestation) {
              // Live: the burn committed (money moved); finish mint→split in the
              // background and treat the prior as settled for the gate.
              after(() => settlePendingByToken(body.priorToken!).catch(() => undefined));
            } else {
              // Live pending with no committed burn → unsafe; fail it and block.
              await failLedgerByToken(body.priorToken);
              return Response.json(
                { blocked: true, error: "prior_unsettled", friendly: "Your previous payment didn't go through. Retry or top up to continue." },
                { status: 402 }
              );
            }
          }
        }

        // Charge the cap for THIS block (atomic double-spend guard).
        const oCharge = await chargePaySession(claims.sessionId, content.price_per_block);
        if (!oCharge.ok) {
          const friendly =
            oCharge.reason === "cap_exceeded"
              ? "You've reached your silent-spend cap. Top up to keep reading."
              : "Your silent-payment session has ended — set it up again.";
          return Response.json({ error: oCharge.reason, friendly }, { status: 402 });
        }

        // Record a pending + optimistic row (per-chunk split already attached) and
        // return the text immediately — the reader renders before settlement.
        await insertLedger({
          contentId: content.id,
          creatorId: content.creator_id,
          payerId: claims.mainWallet as Address,
          payerKind: "human",
          blockIndex,
          grossAmount: split.gross,
          creatorAmount: split.creatorAmount,
          platformAmount: split.platformAmount,
          referrerAmount: split.referrerAmount,
          reserveAmount: split.reserveAmount,
          referrerId,
          paySessionId: claims.sessionId,
          paymentToken: salt,
          txHash: null,
          status: "pending",
          optimistic: true,
        });
        await recordAdminEvent({
          eventType: "UNLOCK",
          payerId: claims.mainWallet as Address,
          contentId: content.id,
          blockIndex,
          amountGross: split.gross,
          metadata: { slug: content.slug, optimistic: true },
        });

        if (simulate && body.simulateFail) {
          // Test hook: force this block to fail so the next combined check blocks.
          await failLedgerByToken(salt);
          await chargePaySession(claims.sessionId, `-${content.price_per_block}`).catch(() => undefined);
        } else if (!simulate) {
          // Live: commit the burn (money moves) before showing, then mint→split
          // in the background. On burn failure, mark failed + refund the cap.
          const creatorWallet = (walletCheck.checksummed ?? BURN) as Address;
          let referrerWallet: Address | null = null;
          if (referrerId) {
            const refUser = await getUserById(referrerId);
            referrerWallet = (validateWallet(refUser?.wallet_address).checksummed ?? null) as Address | null;
          }
          let burn: { attestation: Hex; signature: Hex };
          try {
            burn = await submitBurnIntent(burnIntent, signature);
          } catch (e) {
            await failLedgerByToken(salt);
            await chargePaySession(claims.sessionId, `-${content.price_per_block}`).catch(() => undefined);
            const detail = String((e as Error)?.message ?? e);
            return Response.json({ error: "burn_failed", detail, friendly: friendlyError(detail) }, { status: 402 });
          }
          after(async () => {
            try {
              await setLedgerAttestation(salt, burn.attestation, burn.signature);
              await ensureRevenueSplitApproval();
              const mintTx = await relayMint(burn.attestation, burn.signature);
              await setLedgerMintTx(salt, mintTx);
              const splitTx = await splitOnChain(creatorWallet, referrerWallet, amountWei);
              await finalizeLedgerByToken(salt, splitTx);
            } catch (err) {
              console.error("[reader optimistic settle]", String((err as Error)?.message ?? err));
            }
          });
        }

        return Response.json({ paid: true, optimistic: true, blocked: false, blockIndex, text: chunk!.text, token: salt });
      }

      // Atomically charge the cap (the concurrency guard for double-spends).
      const charge = await chargePaySession(claims.sessionId, content.price_per_block);
      if (!charge.ok) {
        const friendly =
          charge.reason === "cap_exceeded"
            ? "You've reached your silent-spend cap. Top up to keep reading."
            : "Your silent-payment session has ended — set it up again.";
        return Response.json({ error: charge.reason, friendly }, { status: 402 });
      }

      if (!simulate) {
        // Resolve the on-chain payout targets for RevenueSplit.split(...).
        const creatorWallet = (walletCheck.checksummed ?? BURN) as Address;
        let referrerWallet: Address | null = null;
        if (referrerId) {
          const refUser = await getUserById(referrerId);
          referrerWallet = (validateWallet(refUser?.wallet_address).checksummed ?? null) as Address | null;
        }

        // Submit the burn to Gateway — this debits the unified balance. If it
        // fails, refund the cap charge so the allowance isn't consumed.
        let burn: { attestation: Hex; signature: Hex };
        try {
          burn = await submitBurnIntent(burnIntent, signature);
        } catch (e) {
          await chargePaySession(claims.sessionId, `-${content.price_per_block}`).catch(() => undefined);
          const detail = String((e as Error)?.message ?? e);
          return Response.json({ error: "burn_failed", detail, friendly: friendlyError(detail) }, { status: 402 });
        }

        // Burn committed → mint + split AFTER responding so the reader unlocks
        // immediately. The ledger row is recorded pending and flipped to
        // completed once RevenueSplit.split lands on Arc.
        after(async () => {
          try {
            // Persist the attestation FIRST so a failed mint/split below leaves a
            // retryable pending row (admin → Payments → Retry settle).
            await setLedgerAttestation(salt, burn.attestation, burn.signature);
            await ensureRevenueSplitApproval();
            const mintTx = await relayMint(burn.attestation, burn.signature);
            await setLedgerMintTx(salt, mintTx);
            const splitTx = await splitOnChain(creatorWallet, referrerWallet, amountWei);
            await finalizeLedgerByToken(salt, splitTx);
          } catch (err) {
            // Burn already happened (recoverable via the Gateway attestation);
            // leave the row pending for reconciliation rather than failing it.
            console.error("[reader live settle]", String((err as Error)?.message ?? err));
          }
        });

        // finalize() records the pending ledger row and returns the text now.
        return finalize(salt, claims.mainWallet as Address, { paymentToken: salt, paySessionId: claims.sessionId });
      }

      return finalize(salt, claims.mainWallet as Address, { paymentToken: salt, paySessionId: claims.sessionId });
    }

    // ── Direct-transfer path ────────────────────────────────────────────────────
    if (body.directTx?.hash) {
      const existing = await getLedgerByToken(body.directTx.hash);
      if (existing) return Response.json({ error: "tx_already_used", friendly: "That payment was already used." }, { status: 409 });
      const verify = await verifyDirectTransfer(body.directTx.hash, payTo, amount);
      if (!verify.ok) {
        return Response.json({ error: verify.reason ?? "transfer_failed", friendly: "That transfer didn't pay the expected USDC." }, { status: 402 });
      }
      return finalize(body.directTx.hash, verify.payer ?? body.directTx.from ?? payTo);
    }

    // ── Gateway settle path ───────────────────────────────────────────────────
    const { authorization, signature } = body;
    if (!authorization || !signature) return Response.json({ error: "missing_authorization" }, { status: 400 });
    if (BigInt(authorization.value) !== BigInt(amount))
      return Response.json({ error: "amount_mismatch", friendly: "Price changed — please try again." }, { status: 400 });
    if (String(authorization.to).toLowerCase() !== payTo.toLowerCase())
      return Response.json({ error: "recipient_mismatch", friendly: "Recipient mismatch — please try again." }, { status: 400 });

    // Circle /v1/x402/settle requires `resource` (object) + `accepted` in the payload.
    const resourceUrl = `${req.nextUrl.origin}/read/${content.slug}#block-${blockIndex}`;
    const accepted = { ...requirements, resource: resourceUrl };
    const resourceObj = { url: resourceUrl, description: `Unlock block ${blockIndex} of "${content.title}"`, mimeType: "application/json" };
    let result;
    try {
      result = await settleViaCircle(
        { x402Version: 2, resource: resourceObj, accepted, payload: { authorization, signature } },
        accepted
      );
    } catch (e) {
      const detail = String((e as Error)?.message ?? e);
      return Response.json({ error: "settlement_failed", detail, friendly: friendlyError(detail) }, { status: 402 });
    }
    if (!result?.success) {
      const reason = result?.errorReason ?? "unknown";
      return Response.json({ error: "gateway_rejected", detail: reason, friendly: friendlyError(reason) }, { status: 402 });
    }
    const txUuid = String(result.transaction ?? "");
    const txHash = txUuid.startsWith("0x") ? txUuid : `0x${txUuid.replace(/-/g, "")}`;
    return finalize(txHash, (result.payer as Address) ?? authorization.from);
  } catch (e) {
    const detail = String((e as Error)?.message ?? e);
    return Response.json({ error: "reader_error", detail, friendly: friendlyError(detail) }, { status: 500 });
  }
}
