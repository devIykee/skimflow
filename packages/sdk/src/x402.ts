import { randomBytes } from "node:crypto";
import type {
  Address,
  Hex,
  PaymentPayload,
  PaymentRequiredBody,
  PaymentRequirement,
} from "./types.js";

/** Random 32-byte nonce for a payment quote. */
export function newNonce(): Hex {
  return ("0x" + randomBytes(32).toString("hex")) as Hex;
}

/** Build an x402 v2 402-response body for a single requirement. */
export function buildPaymentRequired(
  req: PaymentRequirement
): PaymentRequiredBody {
  return {
    x402Version: 2,
    error: "X-Payment header is required to access this resource.",
    accepts: [req],
  };
}

/** Encode a payment payload for the `X-PAYMENT` request header. */
export function encodePayment(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

/** Decode the `X-PAYMENT` header. Returns null if malformed. */
export function decodePayment(header: string | null | undefined): PaymentPayload | null {
  if (!header) return null;
  try {
    const json = Buffer.from(header, "base64").toString("utf8");
    return JSON.parse(json) as PaymentPayload;
  } catch {
    return null;
  }
}

/** Assemble a PaymentRequirement from content + pricing context. */
export function quoteRequirement(args: {
  amount: string;
  asset: Address;
  payTo: Address;
  contentId: string;
  resource: string;
  lineStart: number;
  lineEnd: number;
  lineCount: number;
  pricePerLine: string;
  creatorHandle: string;
  verifiedCreator: boolean;
  description?: string;
  maxTimeoutSeconds?: number;
}): PaymentRequirement {
  return {
    scheme: "gateway-exact",
    network: "arc-testnet",
    amount: args.amount,
    asset: args.asset,
    payTo: args.payTo,
    resource: args.resource,
    description:
      args.description ??
      `Read lines ${args.lineStart}-${args.lineEnd} of ${args.contentId}`,
    maxTimeoutSeconds: args.maxTimeoutSeconds ?? 120,
    nonce: newNonce(),
    extra: {
      contentId: args.contentId,
      lineStart: args.lineStart,
      lineEnd: args.lineEnd,
      lineCount: args.lineCount,
      pricePerLine: args.pricePerLine,
      creatorHandle: args.creatorHandle,
      verifiedCreator: args.verifiedCreator,
    },
  };
}
