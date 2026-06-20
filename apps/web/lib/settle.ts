/**
 * Settlement recovery for stuck (pending) silent payments. A live silent burn
 * commits the Gateway transfer and stores its attestation; if the background
 * mint→split failed, the row stays pending. This finishes it — re-minting only
 * if needed (mint_tx not yet recorded) — without re-burning.
 *
 * Only rows that carry a stored `attestation` (the silent path) are auto-
 * retryable. x402 rows (Circle batch UUID) settle via webhook and must be
 * resolved with an explicit mark-completed/mark-failed override.
 */
import { getAddress } from "viem";
import type { Address, Hex } from "viem";
import {
  getLedgerByToken,
  getUserById,
  finalizeLedgerByToken,
  setLedgerMintTx,
} from "./store.js";
import {
  ensureRevenueSplitApproval,
  relayMint,
  splitOnChain,
} from "./gateway-relayer.js";
import { validateWallet } from "./validate-wallet.js";
import { toBaseUnits } from "./money.js";

const BURN = "0x000000000000000000000000000000000000dEaD" as Address;

export interface SettleResult {
  ok: boolean;
  token: string;
  reason?: string;
  splitTx?: string;
}

/** Retry mint→split for one pending silent-payment row. */
export async function settlePendingByToken(token: string): Promise<SettleResult> {
  const row = await getLedgerByToken(token);
  if (!row) return { ok: false, token, reason: "not_found" };
  if (row.status !== "pending") return { ok: false, token, reason: "not_pending" };
  if (!row.attestation || !row.burn_signature)
    return { ok: false, token, reason: "not_retryable" };

  const creator = row.creator_id ? await getUserById(row.creator_id) : undefined;
  const creatorWallet = (validateWallet(creator?.wallet_address).checksummed ?? BURN) as Address;

  let referrerWallet: Address | null = null;
  if (row.referrer_id) {
    const ref = await getUserById(row.referrer_id);
    referrerWallet = (validateWallet(ref?.wallet_address).checksummed ?? null) as Address | null;
  }

  const amountWei = toBaseUnits(row.gross_amount);

  await ensureRevenueSplitApproval();
  if (!row.mint_tx) {
    const mintTx = await relayMint(row.attestation as Hex, row.burn_signature as Hex);
    await setLedgerMintTx(token, mintTx);
  }
  const splitTx = await splitOnChain(getAddress(creatorWallet), referrerWallet, amountWei);
  await finalizeLedgerByToken(token, splitTx);
  return { ok: true, token, splitTx };
}
