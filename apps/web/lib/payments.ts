import {
  GatewayClient,
  loadArcConfig,
  quoteRequirement,
  splitRevenue,
  DEFAULT_SPLIT_BPS,
  lineRangeCost,
  sliceLines,
  hashContent,
  type Address,
  type PaymentRequirement,
} from "@linepay/sdk";
import type { Content, Creator } from "./store.js";

/** Shared Arc config + Gateway client for the server (verifier/settler role). */
export const arc = loadArcConfig();
export const gateway = new GatewayClient(arc);

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** A valid, well-known burn address. Last-resort payout so a sale can always
 * settle on-chain even if every configured address is missing/malformed. */
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;

/** Return `a` only if it's a syntactically valid EVM address, else undefined. */
function validAddr(a?: string | null): Address | undefined {
  return a && HEX_ADDRESS.test(a) ? (a as Address) : undefined;
}

function platformAddress(): Address {
  return validAddr(process.env.PLATFORM_ADDRESS) ?? BURN_ADDRESS;
}
function referrerAddress(): Address {
  return validAddr(process.env.REFERRER_ADDRESS) ?? BURN_ADDRESS;
}

/**
 * Resolve the on-chain recipient for a creator's sales. Layered so it always
 * yields a valid address (never 422s the payment):
 *   1. REVENUE_SPLIT_ADDRESS  — on-chain split contract, if configured
 *   2. CREATOR_PAYOUT_ADDRESS — demo override: route every sale here (easily
 *      swapped in env for a "send to nowhere" dummy or your own wallet)
 *   3. the creator's own wallet, if it's a valid address
 *   4. BURN_ADDRESS           — last-resort fallback
 */
export function payoutAddress(creator: Creator): Address {
  return (
    validAddr(arc.revenueSplitAddress) ??
    validAddr(process.env.CREATOR_PAYOUT_ADDRESS) ??
    validAddr(creator.wallet) ??
    BURN_ADDRESS
  );
}

/**
 * Build the x402 PaymentRequirement for a line range of a piece of content.
 * payTo is the RevenueSplit contract when configured (so the split happens
 * on-chain), otherwise the creator directly.
 */
export function requirementFor(
  content: Content,
  creator: Creator,
  lineStart: number,
  lineEnd: number,
  baseUrl: string
): PaymentRequirement {
  const { lineCount, total } = lineRangeCost(
    BigInt(content.price_per_line),
    lineStart,
    lineEnd
  );
  const payTo = payoutAddress(creator);
  return quoteRequirement({
    amount: total.toString(),
    asset: arc.usdcAddress,
    payTo,
    contentId: content.id,
    resource: `${baseUrl}/api/content/${content.id}?lineStart=${lineStart}&lineEnd=${lineEnd}`,
    lineStart,
    lineEnd,
    lineCount,
    pricePerLine: content.price_per_line,
    creatorHandle: creator.handle,
    verifiedCreator: !!creator.verified,
    description: `Read lines ${lineStart}-${lineEnd} of "${content.title}" by @${creator.handle}`,
  });
}

/** Compute the revenue split for a settled amount. */
export function splitFor(total: bigint, creator: Creator) {
  return splitRevenue(
    total,
    payoutAddress(creator),
    platformAddress(),
    referrerAddress(),
    DEFAULT_SPLIT_BPS
  );
}

export { sliceLines, hashContent };
