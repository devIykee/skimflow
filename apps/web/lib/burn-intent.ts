/**
 * Isomorphic Circle Gateway BurnIntent helpers — shared by the browser session
 * signer (lib/session-key-client.ts) and the server relayer/verifier
 * (lib/gateway-relayer.ts, the reader route). NO node- or browser-only imports
 * here so both bundles can use it.
 *
 * The EIP-712 type definitions, domain, and the bytes32 left-padding are taken
 * VERBATIM from the Circle `use-gateway` delegate reference and MUST NOT be
 * altered — changing field names, types, order, or padding produces invalid
 * signatures.
 */
import { getAddress } from "viem";
import type { Address, Hex } from "viem";

// ── Testnet contract addresses (all EVM testnet chains share these) ──────────
export const GATEWAY_WALLET_ADDRESS = (process.env.NEXT_PUBLIC_GATEWAY_WALLET_ADDRESS ||
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9") as Address;
export const GATEWAY_MINTER_ADDRESS = (process.env.NEXT_PUBLIC_GATEWAY_MINTER_ADDRESS ||
  "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B") as Address;

// Arc testnet: Gateway/CCTP domain 26, ERC-20 USDC (6 decimals).
export const ARC_DOMAIN = Number(process.env.NEXT_PUBLIC_ARC_GATEWAY_DOMAIN ?? "26");
export const ARC_USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ||
  "0x3600000000000000000000000000000000000000") as Address;

export const GATEWAY_DOMAIN = { name: "GatewayWallet", version: "1" } as const;

/** EIP-712 types for the delegate burn-intent signature (viem omits EIP712Domain). */
export const BURN_INTENT_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
} as const;

export const MAX_UINT256 = (1n << 256n) - 1n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Default max Gateway fee (USDC base units) authorized per burn. Circle requires
 * a non-zero fee (≈0.0035 USDC on Arc testnet); we authorize a little headroom.
 * Override via NEXT_PUBLIC_GATEWAY_MAX_FEE (browser) or GATEWAY_MAX_FEE (server).
 */
export function defaultMaxFee(): bigint {
  const raw =
    (typeof process !== "undefined" &&
      (process.env?.NEXT_PUBLIC_GATEWAY_MAX_FEE || process.env?.GATEWAY_MAX_FEE)) ||
    "";
  const n = raw ? BigInt(raw) : 0n;
  return n > 0n ? n : 5_000n; // 0.005 USDC
}

/** Left-pad a 20-byte address to a 32-byte hex word (per the Circle reference). */
export function addressToBytes32(address: string): Hex {
  return ("0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0")) as Hex;
}

/** Inverse of addressToBytes32 — recover the checksummed address from a word. */
export function bytes32ToAddress(word: string): Address {
  const hex = word.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return getAddress("0x" + hex.slice(24));
}

/** Transport form of a burn intent — all integers as decimal strings (JSON-safe). */
export interface WireBurnIntent {
  maxBlockHeight: string;
  maxFee: string;
  spec: {
    version: number;
    sourceDomain: number;
    destinationDomain: number;
    sourceContract: Hex;
    destinationContract: Hex;
    sourceToken: Hex;
    destinationToken: Hex;
    sourceDepositor: Hex;
    destinationRecipient: Hex;
    sourceSigner: Hex;
    destinationCaller: Hex;
    value: string;
    salt: Hex;
    hookData: Hex;
  };
}

export interface BuildBurnIntentArgs {
  /** Depositor / main wallet that owns the Gateway balance. */
  mainWallet: Address;
  /** Local session (delegate) key that signs this intent. */
  sessionAddress: Address;
  /** Who receives the minted USDC on Arc (the platform relayer). */
  recipient: Address;
  /** Payment amount in USDC base units (6 decimals). */
  value: bigint;
  /** 32-byte random salt (idempotency key). */
  salt: Hex;
  maxFee?: bigint;
  maxBlockHeight?: bigint;
}

/**
 * Build an Arc→Arc (intra-domain) burn intent: burn from the main wallet's
 * unified balance, mint to the relayer on Arc. Returns the JSON-safe wire form.
 */
export function buildBurnIntent(args: BuildBurnIntentArgs): WireBurnIntent {
  return {
    maxBlockHeight: (args.maxBlockHeight ?? MAX_UINT256).toString(),
    maxFee: (args.maxFee ?? defaultMaxFee()).toString(),
    spec: {
      version: 1,
      sourceDomain: ARC_DOMAIN,
      destinationDomain: ARC_DOMAIN,
      sourceContract: addressToBytes32(GATEWAY_WALLET_ADDRESS),
      destinationContract: addressToBytes32(GATEWAY_MINTER_ADDRESS),
      sourceToken: addressToBytes32(ARC_USDC_ADDRESS),
      destinationToken: addressToBytes32(ARC_USDC_ADDRESS),
      sourceDepositor: addressToBytes32(args.mainWallet),
      destinationRecipient: addressToBytes32(args.recipient),
      sourceSigner: addressToBytes32(args.sessionAddress),
      destinationCaller: addressToBytes32(ZERO_ADDRESS),
      value: args.value.toString(),
      salt: args.salt,
      hookData: "0x",
    },
  };
}

/**
 * Canonical message the main wallet signs ONCE to authorize a session key.
 * Built identically on client and server so the signature verifies. Binds the
 * session address + cap so a captured signature can't authorize a different key
 * or a larger cap.
 */
export function paySessionAuthMessage(args: {
  mainWallet: string;
  sessionAddress: string;
  cap: string;
}): string {
  return [
    "LinePay Cite — authorize silent payments",
    "",
    `Wallet: ${getAddress(args.mainWallet)}`,
    `Session key: ${getAddress(args.sessionAddress)}`,
    `Spend cap: ${args.cap} USDC`,
    "",
    "Signing lets this device pay for chunks silently up to the cap. No funds move on signing.",
  ].join("\n");
}

/** Convert the wire form to the typed message viem signs/verifies (bigint uints). */
export function toTypedMessage(wire: WireBurnIntent) {
  return {
    maxBlockHeight: BigInt(wire.maxBlockHeight),
    maxFee: BigInt(wire.maxFee),
    spec: {
      ...wire.spec,
      value: BigInt(wire.spec.value),
    },
  };
}
