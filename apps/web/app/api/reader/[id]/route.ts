import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, getAddress, http, parseEventLogs, erc20Abi } from "viem";
import { getContent, getCreator, recordPayment, paymentExistsByTx } from "@/lib/store";
import { arc, requirementFor, splitFor, sliceLines, hashContent } from "@/lib/payments";
import { formatUsdc, type Address, type Hex, type SettlementReceipt } from "@linepay/sdk";

/** Read-only Arc client for verifying direct on-chain USDC transfers. */
function arcPublicClient() {
  return createPublicClient({
    chain: {
      id: arc.chainId,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [arc.rpcUrl] } },
    } as any,
    transport: http(arc.rpcUrl),
  });
}

/**
 * Human reader pay-per-line endpoint — REAL Circle Gateway settlement on Arc.
 *
 * Two-phase so the browser wallet (MetaMask) can sign:
 *
 *   Phase 1 (quote): POST { lineStart, lineEnd }            (no signature)
 *     → { needsPayment, requirements }  — the x402 PaymentRequirements the
 *       browser signs as an EIP-3009 TransferWithAuthorization against the
 *       GatewayWalletBatched domain.
 *
 *   Phase 2 (settle): POST { lineStart, lineEnd, authorization, signature }
 *     → server forwards the signed payload to Circle Gateway's
 *       BatchFacilitatorClient.settle(); on success it unlocks the lines and
 *       records the payment. The creator is paid in USDC, gas-free, batched.
 *
 * Free preview (lineEnd ≤ free_lines) returns text with no payment.
 */
const GATEWAY_WALLET = (process.env.GATEWAY_WALLET_ADDRESS ||
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9") as Address;
const NETWORK = process.env.ARC_NETWORK_CAIP2 || "eip155:5042002";
const MAX_TIMEOUT_SECONDS = 600;

/** x402 PaymentRequirements in Circle's batching shape. */
function batchingRequirements(amount: string, payTo: Address) {
  return {
    scheme: "exact",
    network: NETWORK,
    asset: getAddress(arc.usdcAddress),
    amount,
    payTo: getAddress(payTo),
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: getAddress(GATEWAY_WALLET),
    },
  };
}

interface CircleSettleResponse {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  errorReason?: string;
}

/**
 * Settle through Circle Gateway's batched facilitator.
 *
 * This is exactly what `@circle-fin/x402-batching` BatchFacilitatorClient.settle
 * does — `POST {host}/v1/x402/settle` with `{ paymentPayload, paymentRequirements }`
 * and only a `Content-Type` header (the buyer's EIP-712 signature is the
 * authorization; testnet needs no API key). We call it directly so we don't pull
 * the SDK's optional `@x402/evm` peer dependency into the Next.js bundle.
 */
async function settleViaCircle(
  paymentPayload: unknown,
  paymentRequirements: unknown
): Promise<CircleSettleResponse> {
  const url = `${arc.gatewayUrl.replace(/\/$/, "")}/v1/x402/settle`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentPayload, paymentRequirements }),
  });
  const text = await res.text();
  if (!text) throw new Error(`gateway_empty_response:${res.status}`);
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`gateway_bad_response:${res.status}:${text.slice(0, 200)}`);
  }
  if (typeof data !== "object" || data === null || !("success" in data)) {
    throw new Error(`gateway_settle_failed:${res.status}:${text.slice(0, 200)}`);
  }
  return data as CircleSettleResponse;
}

/** Map raw Circle/Gateway error reasons to a human-readable message. */
function friendlyError(raw: string): string {
  const r = (raw || "").toLowerCase();
  if (/insufficient|balance|funds/.test(r))
    return "Insufficient Gateway balance. Deposit more test USDC into your wallet's Circle Gateway balance, then try again.";
  if (/expired|valid_?before|too late/.test(r))
    return "The signed authorization expired. Please sign again.";
  if (/nonce|already|replay|used/.test(r))
    return "This authorization was already used. Click Pay again to sign a fresh one.";
  if (/signature|invalid_?sig|recover/.test(r))
    return "The signature didn't validate for Arc testnet. Make sure your wallet is on Arc Testnet (5042002).";
  if (/network|chain|unsupported/.test(r))
    return "Unsupported network. Switch your wallet to Arc Testnet (5042002).";
  if (/recipient|payto|address/.test(r))
    return "The creator's payout address is invalid.";
  return raw || "Payment could not be settled.";
}

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = await req.json().catch(() => ({}));
    const lineStart = Math.max(1, Number(body.lineStart ?? 1));
    const lineEnd = Math.max(lineStart, Number(body.lineEnd ?? lineStart));

    const content = getContent(id);
    if (!content) return NextResponse.json({ error: "content_not_found", friendly: "This content no longer exists." }, { status: 404 });
    const creator = getCreator(content.creator_id);
    if (!creator) return NextResponse.json({ error: "creator_not_found", friendly: "This content's creator is missing." }, { status: 404 });

    const baseUrl = process.env.APP_BASE_URL ?? new URL(req.url).origin;

    // Free preview — no payment.
    if (lineEnd <= content.free_lines) {
      const { text, actualStart, actualEnd, lineCount } = sliceLines(content.body, lineStart, lineEnd);
      return NextResponse.json({
        paid: false, free: true, lineStart: actualStart, lineEnd: actualEnd, lineCount, text,
      });
    }

    const requirement = requirementFor(content, creator, lineStart, lineEnd, baseUrl);
    const amount = requirement.amount;
    const payTo = requirement.payTo as Address;
    if (!HEX_ADDRESS.test(payTo)) {
      return NextResponse.json(
        { error: "creator_wallet_invalid", friendly: `@${creator.handle}'s payout wallet is not a valid address — they need to update it before they can be paid.` },
        { status: 422 }
      );
    }
    const requirements = batchingRequirements(amount, payTo);

    // ── Direct-transfer settlement (fallback path) ──────────────────────────
    // For wallets with no Gateway balance: the browser sends USDC straight to
    // the creator on-chain, then posts the tx hash here. We verify it actually
    // happened (right token, recipient, amount) before unlocking — one popup,
    // no pre-deposit. Idempotent on tx hash so a transfer can't double-unlock.
    const directTx = body.directTx as { hash: Hex; from?: Address } | undefined;
    if (directTx?.hash) {
      if (paymentExistsByTx(directTx.hash)) {
        return NextResponse.json(
          { error: "tx_already_used", friendly: "That payment was already used to unlock these lines." },
          { status: 409 }
        );
      }
      let receipt;
      try {
        receipt = await arcPublicClient().getTransactionReceipt({ hash: directTx.hash });
      } catch {
        return NextResponse.json(
          { error: "tx_not_found", friendly: "Couldn't find that transaction yet — give it a moment and try again." },
          { status: 404 }
        );
      }
      if (receipt.status !== "success") {
        return NextResponse.json(
          { error: "tx_reverted", friendly: "The USDC transfer failed on-chain. Nothing was unlocked." },
          { status: 402 }
        );
      }
      const usdc = getAddress(arc.usdcAddress);
      const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
      const match = transfers.find(
        (l) =>
          getAddress(l.address) === usdc &&
          getAddress(l.args.to as Address) === payTo &&
          (l.args.value as bigint) >= BigInt(amount)
      );
      if (!match) {
        return NextResponse.json(
          { error: "transfer_mismatch", friendly: "That transaction didn't pay the creator the expected USDC amount." },
          { status: 402 }
        );
      }
      const payer = getAddress((match.args.from as Address) ?? directTx.from ?? payTo);
      const { text, actualStart, actualEnd, lineCount } = sliceLines(content.body, lineStart, lineEnd);
      const settlement: SettlementReceipt = {
        success: true, network: "arc-testnet", txHash: directTx.hash,
        amount, payTo, payer, settledAt: Date.now(), simulated: false,
      };
      recordPayment({
        content, payer, payerKind: "human",
        lineStart: actualStart, lineEnd: actualEnd, lineCount,
        split: splitFor(BigInt(amount), creator), receipt: settlement, contentHash: hashContent(text),
      });
      return NextResponse.json({
        paid: true, simulated: false, method: "direct",
        lineStart: actualStart, lineEnd: actualEnd, lineCount,
        amount, amountDisplay: formatUsdc(amount),
        pricePerLineDisplay: formatUsdc(content.price_per_line),
        txHash: directTx.hash, text,
      });
    }

    // ── Phase 1: quote ──────────────────────────────────────────────────────
    const authorization = body.authorization as
      | { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex }
      | undefined;
    const signature = body.signature as Hex | undefined;

    if (!authorization || !signature) {
      return NextResponse.json({
        needsPayment: true,
        requirements,
        lineStart,
        lineEnd,
        lineCount: lineEnd - lineStart + 1,
        amount,
        amountDisplay: formatUsdc(amount),
        chainId: arc.chainId,
      });
    }

    // ── Phase 2: settle ───────────────────────────────────────────────────────
    // The signed authorization must match OUR price + recipient (the server is
    // authoritative — a client can't unlock by signing a cheaper/foreign auth).
    if (BigInt(authorization.value) !== BigInt(amount)) {
      return NextResponse.json({ error: "amount_mismatch", friendly: "Price changed — please try again.", expected: amount }, { status: 400 });
    }
    if (String(authorization.to).toLowerCase() !== payTo.toLowerCase()) {
      return NextResponse.json({ error: "recipient_mismatch", friendly: "Recipient mismatch — please try again.", expected: payTo }, { status: 400 });
    }

    const paymentPayload = {
      x402Version: 2,
      payload: { authorization, signature },
    };

    let result;
    try {
      result = await settleViaCircle(paymentPayload, requirements);
    } catch (e: any) {
      const detail = String(e?.message ?? e);
      return NextResponse.json(
        { error: "settlement_failed", detail, friendly: friendlyError(detail) },
        { status: 402 }
      );
    }
    if (!result?.success) {
      const reason = result?.errorReason ?? "unknown";
      return NextResponse.json(
        { error: "gateway_rejected", detail: reason, friendly: friendlyError(reason) },
        { status: 402 }
      );
    }

    // Real settlement succeeded — unlock + record.
  const { text, actualStart, actualEnd, lineCount } = sliceLines(content.body, lineStart, lineEnd);
  const txUuid = String(result.transaction ?? "");
  const txHash = (txUuid.startsWith("0x") ? txUuid : `0x${txUuid.replace(/-/g, "")}`) as Hex;
  const receipt: SettlementReceipt = {
    success: true,
    network: "arc-testnet",
    txHash,
    batchId: txUuid,
    amount,
    payTo,
    payer: (result.payer as Address) ?? authorization.from,
    settledAt: Date.now(),
    simulated: false,
  };
  const split = splitFor(BigInt(amount), creator);
  recordPayment({
    content, payer: authorization.from, payerKind: "human",
    lineStart: actualStart, lineEnd: actualEnd, lineCount,
    split, receipt, contentHash: hashContent(text),
  });

  return NextResponse.json({
    paid: true,
    simulated: false,
    lineStart: actualStart,
    lineEnd: actualEnd,
    lineCount,
    amount,
    amountDisplay: formatUsdc(amount),
    pricePerLineDisplay: formatUsdc(content.price_per_line),
    txHash,
    batchId: txUuid,
    network: result.network,
    text,
  });
  } catch (e: any) {
    const detail = String(e?.message ?? e);
    return NextResponse.json(
      { error: "reader_error", detail, friendly: friendlyError(detail) },
      { status: 500 }
    );
  }
}
