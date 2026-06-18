"use client";

/**
 * Browser-side session key for silent chunk payments. A keypair is generated
 * locally, the private key is kept in localStorage and NEVER leaves the device.
 * The main wallet authorizes this key once as a Gateway delegate; afterwards it
 * signs each chunk's BurnIntent with no wallet popup (signTypedData on the local
 * viem account is synchronous + popup-free).
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex, PrivateKeyAccount } from "viem";
import {
  GATEWAY_DOMAIN,
  BURN_INTENT_TYPES,
  buildBurnIntent,
  toTypedMessage,
  type WireBurnIntent,
} from "./burn-intent.js";

const keyStorageKey = (mainWallet: string) => `linepay_paykey_${mainWallet.toLowerCase()}`;

/** Load the existing session account for a main wallet, or null if none. */
export function loadSessionAccount(mainWallet: string): PrivateKeyAccount | null {
  try {
    const pk = localStorage.getItem(keyStorageKey(mainWallet));
    if (!pk) return null;
    return privateKeyToAccount(pk as Hex);
  } catch {
    return null;
  }
}

/** Get the existing session account or generate + persist a fresh one. */
export function getOrCreateSessionAccount(mainWallet: string): PrivateKeyAccount {
  const existing = loadSessionAccount(mainWallet);
  if (existing) return existing;
  const pk = generatePrivateKey();
  try {
    localStorage.setItem(keyStorageKey(mainWallet), pk);
  } catch {
    /* private mode / quota — the key still works for this tab */
  }
  return privateKeyToAccount(pk);
}

/** Forget the local session key (after revoke). */
export function clearSessionKey(mainWallet: string): void {
  try {
    localStorage.removeItem(keyStorageKey(mainWallet));
  } catch {
    /* ignore */
  }
}

function randomSalt(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return ("0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")) as Hex;
}

export interface SessionPayment {
  burnIntent: WireBurnIntent;
  signature: Hex;
}

/**
 * Silently build + sign a burn intent for one chunk payment. `recipient` is the
 * platform relayer that mints + routes to RevenueSplit (returned by the reader
 * quote). No popup: the local session key signs.
 */
export async function buildSessionPayment(opts: {
  mainWallet: Address;
  recipient: Address;
  value: bigint;
}): Promise<SessionPayment> {
  const account = getOrCreateSessionAccount(opts.mainWallet);
  const burnIntent = buildBurnIntent({
    mainWallet: opts.mainWallet,
    sessionAddress: account.address,
    recipient: opts.recipient,
    value: opts.value,
    salt: randomSalt(),
  });
  const signature = await account.signTypedData({
    domain: GATEWAY_DOMAIN,
    types: BURN_INTENT_TYPES,
    primaryType: "BurnIntent",
    message: toTypedMessage(burnIntent),
  });
  return { burnIntent, signature };
}
