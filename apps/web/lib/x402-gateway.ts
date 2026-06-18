/**
 * `withGateway` — x402 + Circle Gateway payment middleware for AI agents.
 *
 * Wraps a route so an autonomous agent can pay for content machine-to-machine:
 *   • No `X-Payment` header  → HTTP 402 with an x402 `accepts[]` quote.
 *   • Valid `X-Payment`      → verify the signed USDC authorization, settle it
 *                              through Circle Gateway (the SAME facilitator the
 *                              human reader uses), then serve + attach an
 *                              `X-Payment-Response` receipt.
 *
 * Settlement mirrors lib/reader-pay.ts exactly: in simulate mode the signed
 * authorization is validated (amount + recipient) and recorded; in live mode it
 * is settled via POST /v1/x402/settle. This keeps agents and humans on one
 * payment rail.
 */
import { NextRequest } from "next/server";
import { getAddress } from "viem";
import type { Address, Hex } from "viem";
import { batchingRequirements, friendlyError, settleViaCircle } from "./reader-pay.js";
import { toBaseUnits, toDecimal } from "./money.js";

export interface Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

/** Receipt handed to the wrapped handler once payment is verified/settled. */
export interface PaidReceipt {
  payer: Address;
  /** Idempotency key + ledger token: settle tx (live) or the authorization nonce (simulate). */
  txHash: string;
  simulated: boolean;
}

interface DecodedPayment {
  authorization: Authorization;
  signature: Hex;
}

/**
 * Decode the base64 `X-Payment` header. Accepts both the nested shape
 * `{ payload: { authorization, signature } }` and the flat SDK shape
 * `{ payload: { from, to, amount/value, nonce, validBefore, signature } }`.
 */
export function decodeXPayment(header: string | null): DecodedPayment | null {
  if (!header) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
  const root = obj as { payload?: Record<string, unknown> } | undefined;
  const p = (root?.payload ?? root) as Record<string, unknown> | undefined;
  if (!p) return null;

  const sig = (p.signature ?? "0x") as Hex;
  const auth = (p.authorization ?? p) as Record<string, unknown>;
  const from = auth.from as Address | undefined;
  const to = auth.to as Address | undefined;
  const value = (auth.value ?? auth.amount) as string | undefined;
  const nonce = auth.nonce as Hex | undefined;
  if (!from || !to || value == null || !nonce) return null;

  return {
    authorization: {
      from,
      to,
      value: String(value),
      validAfter: String(auth.validAfter ?? "0"),
      validBefore: String(auth.validBefore ?? "0"),
      nonce,
    },
    signature: sig,
  };
}

/** Build the x402 402 response body (standard `accepts[]` + human-friendly fields). */
export function paymentRequiredBody(args: {
  blockIndex?: number;
  amount: string; // base units
  payTo: Address;
  resource: string;
  description?: string;
}) {
  const requirements = batchingRequirements(args.amount, args.payTo);
  return {
    x402Version: 1,
    error: "payment_required",
    accepts: [
      {
        ...requirements,
        resource: args.resource,
        description: args.description ?? "Unlock this content block with USDC on Arc.",
      },
    ],
    // Legacy/human-readable mirror (kept so older agents keep working).
    block_index: args.blockIndex,
    payment_gateway: requirements.extra.verifyingContract,
    pay_to: args.payTo,
    cost_per_block: toDecimal(args.amount),
    currency: "USDC",
    instructions:
      "Sign an EIP-3009 USDC authorization for `pay_to` and retry with header `X-Payment: <base64 payload>` (x402). Legacy: pay then retry with `X-Payment-Token: <token>`.",
  };
}

function jsonResponse(body: unknown, status: number, extraHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export interface WithGatewayOptions {
  /** Price as a decimal USDC string (e.g. "0.05"). */
  price: string;
  /** Recipient of the funds (creator wallet / revenue-split contract). */
  payTo: Address;
  /** Canonical resource URL the payment unlocks. */
  resource: string;
  description?: string;
  /** Extra headers to attach to EVERY response (e.g. rate-limit headers). */
  extraHeaders?: Record<string, string>;
  /** For the 402 body's human mirror. */
  blockIndex?: number;
}

/**
 * Gate a request behind an x402 Circle-Gateway payment. Returns either the 402
 * quote / a settlement error, or — once payment is verified — the result of
 * `onPaid(receipt)` with an `X-Payment-Response` header attached.
 */
export async function withGateway(
  req: NextRequest,
  opts: WithGatewayOptions,
  onPaid: (receipt: PaidReceipt) => Promise<Response> | Response
): Promise<Response> {
  const extra = opts.extraHeaders ?? {};
  const amount = toBaseUnits(opts.price).toString();
  const payTo = getAddress(opts.payTo);

  const decoded = decodeXPayment(req.headers.get("x-payment"));
  if (!decoded) {
    return jsonResponse(
      paymentRequiredBody({ blockIndex: opts.blockIndex, amount, payTo, resource: opts.resource, description: opts.description }),
      402,
      extra
    );
  }

  const { authorization, signature } = decoded;

  // Verify the agent signed for the right amount + recipient before settling.
  if (BigInt(authorization.value) !== BigInt(amount)) {
    return jsonResponse({ error: "amount_mismatch", friendly: "The signed amount doesn't match the price." }, 402, extra);
  }
  if (authorization.to.toLowerCase() !== payTo.toLowerCase()) {
    return jsonResponse({ error: "recipient_mismatch", friendly: "The signed recipient doesn't match the creator's payout address." }, 402, extra);
  }

  const simulate = (process.env.PAYMENTS_MODE ?? "simulate").toLowerCase() !== "live";

  let receipt: PaidReceipt;
  if (simulate) {
    // Validate-and-record (no funds move) — same as the human simulate path.
    receipt = { payer: getAddress(authorization.from), txHash: authorization.nonce, simulated: true };
  } else {
    // Circle /v1/x402/settle requires `resource` (object) + `accepted` (the
    // requirement the client paid) inside paymentPayload.
    const requirements = { ...batchingRequirements(amount, payTo), resource: opts.resource };
    const resourceObj = { url: opts.resource, description: opts.description ?? "Unlock content", mimeType: "application/json" };
    let result;
    try {
      result = await settleViaCircle(
        { x402Version: 2, resource: resourceObj, accepted: requirements, payload: { authorization, signature } },
        requirements
      );
    } catch (e) {
      const detail = String((e as Error)?.message ?? e);
      return jsonResponse({ error: "settlement_failed", detail, friendly: friendlyError(detail) }, 402, extra);
    }
    if (!result?.success) {
      const reason = result?.errorReason ?? "unknown";
      return jsonResponse({ error: "gateway_rejected", detail: reason, friendly: friendlyError(reason) }, 402, extra);
    }
    const txUuid = String(result.transaction ?? "");
    const txHash = txUuid.startsWith("0x") ? txUuid : `0x${txUuid.replace(/-/g, "")}`;
    receipt = { payer: (result.payer as Address) ?? getAddress(authorization.from), txHash, simulated: false };
  }

  const res = await onPaid(receipt);
  // Attach the x402 settlement receipt + carry any extra headers through.
  for (const [k, v] of Object.entries(extra)) if (!res.headers.has(k)) res.headers.set(k, v);
  res.headers.set(
    "X-Payment-Response",
    Buffer.from(
      JSON.stringify({ success: true, network: "eip155:5042002", txHash: receipt.txHash, payer: receipt.payer, amount, simulated: receipt.simulated }),
      "utf8"
    ).toString("base64")
  );
  return res;
}
