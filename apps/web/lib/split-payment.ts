import { toBaseUnits, toDecimal } from "./money.js";

/**
 * Server-side revenue split. NEVER trust the client for these numbers.
 *
 * These shares MIRROR the deployed on-chain RevenueSplit contract
 * (REVENUE_SPLIT_ADDRESS, Arc testnet) so the off-chain ledger reconciles
 * exactly with what `split(creator, referrer, amount)` does on-chain:
 *
 *   creator   80%   (the REMAINDER — gets any rounding dust, never under-pays)
 *   platform  12%
 *   referrer   5%   (paid only when a referrer is present)
 *   reserve    3%   (owner-drainable pool held by the contract)
 *
 * A missing referrer folds the 5% into the reserve (matching the contract's
 * `referrer == address(0)` branch), so a no-referrer payment is 80/12/0/8.
 * All math is in integer base units (bigint) — the four parts always sum to
 * the gross with no float dust.
 */
export const SPLIT_BPS = {
  platform: 1200, // 12%
  referrer: 500, //  5%
  reserve: 300, //  3%
  // creator is the remainder (≈8000 bps / 80%)
  total: 10000,
} as const;

export interface SplitInput {
  /** Gross payment as decimal USDC ("0.05") or base units (bigint). */
  total: string | number | bigint;
  /** Whether a referrer is credited on this payment. */
  hasReferrer: boolean;
}

export interface PaymentSplit {
  /** Decimal USDC strings (DB / API / email facing). */
  gross: string;
  creatorAmount: string;
  platformAmount: string;
  referrerAmount: string;
  reserveAmount: string;
  /** Rates actually applied (for display/audit). */
  platformRate: number;
  referrerRate: number;
  reserveRate: number;
  /** Exact base-unit values, for the on-chain / Gateway layer. */
  base: { gross: bigint; creator: bigint; platform: bigint; referrer: bigint; reserve: bigint };
}

const BPS = BigInt(SPLIT_BPS.total);

/** Compute the split exactly as the on-chain RevenueSplit contract does. */
export function splitPayment(input: SplitInput): PaymentSplit {
  const gross = toBaseUnits(input.total);

  const platform = (gross * BigInt(SPLIT_BPS.platform)) / BPS;
  const referrerShare = (gross * BigInt(SPLIT_BPS.referrer)) / BPS;
  let reserve = (gross * BigInt(SPLIT_BPS.reserve)) / BPS;

  // No referrer → fold the referrer share into the reserve (contract behaviour).
  const referrer = input.hasReferrer ? referrerShare : 0n;
  if (!input.hasReferrer) reserve += referrerShare;

  // Creator is the remainder so the four parts always reconcile to the gross.
  const creator = gross - platform - referrer - reserve;

  return {
    gross: toDecimal(gross),
    creatorAmount: toDecimal(creator),
    platformAmount: toDecimal(platform),
    referrerAmount: toDecimal(referrer),
    reserveAmount: toDecimal(reserve),
    platformRate: SPLIT_BPS.platform / SPLIT_BPS.total,
    referrerRate: (input.hasReferrer ? SPLIT_BPS.referrer : 0) / SPLIT_BPS.total,
    reserveRate: (input.hasReferrer ? SPLIT_BPS.reserve : SPLIT_BPS.reserve + SPLIT_BPS.referrer) / SPLIT_BPS.total,
    base: { gross, creator, platform, referrer, reserve },
  };
}

/**
 * Preview the split for the creator dashboard "commission split" panel without
 * needing a real payment. Returns decimal strings + integer percentages.
 */
export function previewSplit(pricePerBlock: string | number, hasReferrer: boolean) {
  const split = splitPayment({ total: pricePerBlock, hasReferrer });
  const pct = (part: bigint) =>
    split.base.gross === 0n ? 0 : Number((part * 10000n) / split.base.gross) / 100;
  return {
    readerPays: split.gross,
    creator: { amount: split.creatorAmount, pct: pct(split.base.creator) },
    platform: { amount: split.platformAmount, pct: pct(split.base.platform) },
    referrer: { amount: split.referrerAmount, pct: pct(split.base.referrer) },
    reserve: { amount: split.reserveAmount, pct: pct(split.base.reserve) },
    hasReferrer,
  };
}
