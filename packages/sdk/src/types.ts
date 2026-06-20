/**
 * Core domain + x402 protocol types for Skimflow.
 *
 * All monetary amounts are denominated in **USDC base units** (6 decimals).
 * 1 USDC = 1_000_000 base units. A "nanopayment" here can be as small as a
 * single base unit ($0.000001), which is the Circle Gateway floor.
 */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/** USDC has 6 decimals on Arc / Circle. */
export const USDC_DECIMALS = 6;

/**
 * x402 payment requirements returned in an HTTP 402 response body.
 * Mirrors the shape of the x402 protocol's `accepts` entries, specialized for
 * Circle Gateway settlement on Arc.
 */
export interface PaymentRequirement {
  /** Settlement scheme. We use Gateway-batched exact-amount transfers. */
  scheme: "gateway-exact";
  /** Chain the payment settles on. */
  network: "arc-testnet";
  /** Amount owed, in USDC base units, as a decimal string. */
  amount: string;
  /** ERC-20 token contract (USDC on Arc). */
  asset: Address;
  /** Who ultimately receives the funds (creator, or the revenue-split contract). */
  payTo: Address;
  /** Opaque resource identifier the payment unlocks. */
  resource: string;
  /** Human description shown to wallets / agents. */
  description: string;
  /** Seconds the quote is valid for. */
  maxTimeoutSeconds: number;
  /** Nonce the server will reject if replayed. */
  nonce: Hex;
  /** Extra metadata an agent can reason over before paying. */
  extra: {
    contentId: string;
    lineStart: number;
    lineEnd: number;
    lineCount: number;
    pricePerLine: string; // base units per line
    creatorHandle: string;
    verifiedCreator: boolean;
  };
}

/** The full HTTP 402 body (x402 v2). */
export interface PaymentRequiredBody {
  x402Version: 2;
  error: string;
  accepts: PaymentRequirement[];
}

/**
 * The signed payment payload a client puts in the `X-PAYMENT` header (base64
 * JSON). With Circle Gateway this is a gas-free signed authorization the
 * facilitator batches and settles on Arc.
 */
export interface PaymentPayload {
  x402Version: 2;
  scheme: "gateway-exact";
  network: "arc-testnet";
  payload: {
    from: Address;
    to: Address;
    asset: Address;
    amount: string;
    nonce: Hex;
    validBefore: number; // unix seconds
    /** EIP-712 signature over the authorization (empty string in sim mode). */
    signature: Hex | "";
  };
}

/** Returned by the server in `X-PAYMENT-RESPONSE` after settlement. */
export interface SettlementReceipt {
  success: boolean;
  network: "arc-testnet";
  /** Arc tx hash (real mode) or a deterministic sim hash. */
  txHash: Hex;
  /** Gateway batch id, if batched. */
  batchId?: string;
  amount: string;
  payTo: Address;
  payer: Address;
  settledAt: number;
  simulated: boolean;
}

/** Split destinations for a single payment. */
export interface RevenueSplit {
  creator: { address: Address; bps: number; amount: string };
  platform: { address: Address; bps: number; amount: string };
  referrer: { address: Address; bps: number; amount: string };
}
