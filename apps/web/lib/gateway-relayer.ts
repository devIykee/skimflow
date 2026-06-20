/**
 * Server-side Circle Gateway relayer + burn-intent verification.
 *
 * Phase 2a (simulate): only `verifyBurnIntent` + `relayerRecipient` are used —
 * the silent signature is validated, the cap is enforced, the ledger records a
 * completed row. No funds move.
 *
 * Phase 2b (live, PAYMENTS_MODE=live): `submitBurnIntent` posts to Gateway's
 * /v1/transfer, then a funded RELAYER_PRIVATE_KEY calls gatewayMint(...) and
 * RevenueSplit.split(...). The relayer key is read lazily so simulate never
 * needs it.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  http,
  maxUint256,
  parseEther,
  parseUnits,
  recoverTypedDataAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { arc } from "./reader-pay.js";
import {
  BURN_INTENT_TYPES,
  GATEWAY_DOMAIN,
  GATEWAY_MINTER_ADDRESS,
  bytes32ToAddress,
  toTypedMessage,
  type WireBurnIntent,
} from "./burn-intent.js";

/** The relayer signing key: RELAYER_PRIVATE_KEY, falling back to SELLER_PRIVATE_KEY. */
function relayerPk(): string | undefined {
  return process.env.RELAYER_PRIVATE_KEY || process.env.SELLER_PRIVATE_KEY;
}

/**
 * The address that receives minted USDC and forwards it to RevenueSplit. In
 * live mode this MUST be the relayer EOA (it holds the mint and calls split),
 * so we derive it from the relayer key when present; otherwise we fall back
 * to RELAYER_ADDRESS / PLATFORM_ADDRESS (fine for simulate, which moves no funds).
 */
export function relayerRecipient(): Address {
  const pk = relayerPk();
  if (pk) return privateKeyToAccount(normalizePk(pk)).address;
  const raw =
    process.env.RELAYER_ADDRESS ||
    process.env.PLATFORM_ADDRESS ||
    "0x0000000000000000000000000000000000000000";
  return getAddress(raw);
}

function normalizePk(pk: string): Hex {
  const t = pk.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as Hex;
}

export interface VerifyBurnIntentExpectations {
  /** The session (delegate) key that must have signed. */
  signer: Address;
  /** The main wallet that must be the depositor. */
  depositor: Address;
  /** Exact payment value in USDC base units. */
  value: bigint;
}

/**
 * Verify a silently-signed burn intent: the recovered signer matches the
 * authorized session key, the depositor matches the bound main wallet, the
 * recipient is our relayer, and the value equals the quoted price.
 */
export async function verifyBurnIntent(
  wire: WireBurnIntent,
  signature: Hex,
  expect: VerifyBurnIntentExpectations
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
      domain: GATEWAY_DOMAIN,
      types: BURN_INTENT_TYPES,
      primaryType: "BurnIntent",
      message: toTypedMessage(wire),
      signature,
    });
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (getAddress(recovered) !== getAddress(expect.signer)) return { ok: false, reason: "signer_mismatch" };

  const spec = wire.spec;
  if (getAddress(bytes32ToAddress(spec.sourceSigner)) !== getAddress(expect.signer))
    return { ok: false, reason: "spec_signer_mismatch" };
  if (getAddress(bytes32ToAddress(spec.sourceDepositor)) !== getAddress(expect.depositor))
    return { ok: false, reason: "depositor_mismatch" };
  if (getAddress(bytes32ToAddress(spec.destinationRecipient)) !== relayerRecipient())
    return { ok: false, reason: "recipient_mismatch" };
  if (BigInt(spec.value) !== expect.value) return { ok: false, reason: "value_mismatch" };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2b — live settlement (only runs when PAYMENTS_MODE=live)
// ─────────────────────────────────────────────────────────────────────────────

/** POST the signed burn intent to Gateway; returns the mint attestation. */
export async function submitBurnIntent(
  wire: WireBurnIntent,
  signature: Hex
): Promise<{ attestation: Hex; signature: Hex }> {
  const url = `${arc.gatewayUrl.replace(/\/$/, "")}/v1/transfer`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ burnIntent: wire, signature }]),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`gateway_transfer_failed:${res.status}:${text.slice(0, 200)}`);
  const data = JSON.parse(text) as { attestation?: Hex; signature?: Hex };
  if (!data.attestation || !data.signature) throw new Error("gateway_transfer_no_attestation");
  return { attestation: data.attestation, signature: data.signature };
}

/** Query the unified Gateway balance for a depositor on Arc (USDC base units). */
export async function gatewayBalance(depositor: Address): Promise<bigint> {
  const url = `${arc.gatewayUrl.replace(/\/$/, "")}/v1/balances`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: "USDC",
      sources: [{ domain: Number(process.env.NEXT_PUBLIC_ARC_GATEWAY_DOMAIN ?? "26"), depositor }],
    }),
  });
  if (!res.ok) throw new Error(`gateway_balance_failed:${res.status}`);
  const data = (await res.json()) as { balances?: Array<{ balance?: string }> };
  const first = data.balances?.[0]?.balance ?? "0";
  // balance is a decimal USDC string → base units
  const [whole, frac = ""] = first.split(".");
  return BigInt((whole || "0") + (frac + "000000").slice(0, 6));
}

// ── On-chain relayer (mint + RevenueSplit.split) ─────────────────────────────

const GATEWAY_MINTER_ABI = [
  {
    type: "function",
    name: "gatewayMint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "attestationPayload", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const REVENUE_SPLIT_ABI = [
  {
    type: "function",
    name: "split",
    stateMutability: "nonpayable",
    inputs: [
      { name: "creator", type: "address" },
      { name: "referrer", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

function revenueSplitAddress(): Address {
  const raw = process.env.REVENUE_SPLIT_ADDRESS;
  if (!raw) throw new Error("REVENUE_SPLIT_ADDRESS is not set — deploy RevenueSplit first.");
  return getAddress(raw);
}

const arcChain = defineChain({
  id: arc.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [arc.rpcUrl] } },
});

let relayerCache: {
  account: ReturnType<typeof privateKeyToAccount>;
  wallet: ReturnType<typeof createWalletClient>;
  publicClient: ReturnType<typeof createPublicClient>;
} | null = null;

/** Lazily build the funded relayer clients. Throws if no relayer key is set. */
export function getRelayer() {
  if (relayerCache) return relayerCache;
  const pk = relayerPk();
  if (!pk) throw new Error("RELAYER_PRIVATE_KEY (or SELLER_PRIVATE_KEY) is not set — required for live settlement.");
  const account = privateKeyToAccount(normalizePk(pk));
  const wallet = createWalletClient({ account, chain: arcChain, transport: http(arc.rpcUrl) });
  const publicClient = createPublicClient({ chain: arcChain, transport: http(arc.rpcUrl) });
  relayerCache = { account, wallet, publicClient };
  return relayerCache;
}

/** One-time: ensure the relayer has approved RevenueSplit to pull its USDC. */
export async function ensureRevenueSplitApproval(): Promise<void> {
  const { account, wallet, publicClient } = getRelayer();
  const usdc = getAddress(arc.usdcAddress);
  const split = revenueSplitAddress();
  const allowance = await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, split],
  });
  // Re-approve when the allowance dips low (keeps a long-lived max approval).
  if (allowance > maxUint256 / 2n) return;
  const hash = await wallet.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [split, maxUint256],
    account,
    chain: arcChain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

/** Mint the burned USDC to the relayer on Arc using the Gateway attestation. */
export async function relayMint(attestation: Hex, signature: Hex): Promise<Hex> {
  const { account, wallet, publicClient } = getRelayer();
  const hash = await wallet.writeContract({
    address: getAddress(GATEWAY_MINTER_ADDRESS),
    abi: GATEWAY_MINTER_ABI,
    functionName: "gatewayMint",
    args: [attestation, signature],
    account,
    chain: arcChain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Route the minted USDC through RevenueSplit (80/12/5/3) to creator/referrer. */
export async function splitOnChain(creator: Address, referrer: Address | null, value: bigint): Promise<Hex> {
  const { account, wallet, publicClient } = getRelayer();
  const hash = await wallet.writeContract({
    address: revenueSplitAddress(),
    abi: REVENUE_SPLIT_ABI,
    functionName: "split",
    args: [getAddress(creator), referrer ? getAddress(referrer) : ZERO, value],
    account,
    chain: arcChain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ── Admin testnet funding (relayer → users) ──────────────────────────────────

/** Send native Arc gas (USDC at 18 decimals) from the relayer to `to`. */
export async function sendGas(to: Address, amountEth: string): Promise<Hex> {
  const { account, wallet, publicClient } = getRelayer();
  const hash = await wallet.sendTransaction({
    account,
    chain: arcChain,
    to: getAddress(to),
    value: parseEther(amountEth),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** Transfer ERC-20 USDC (6 decimals) from the relayer to `to`. */
export async function sendUsdc(to: Address, amount6: string): Promise<Hex> {
  const { account, wallet, publicClient } = getRelayer();
  const hash = await wallet.writeContract({
    address: getAddress(arc.usdcAddress),
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(to), parseUnits(amount6, 6)],
    account,
    chain: arcChain,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** A read-only Arc public client (shared chain definition) for balance reads. */
export function arcReadClient() {
  return createPublicClient({ chain: arcChain, transport: http(arc.rpcUrl) });
}

/** Read an address's ERC-20 USDC (6-dec) + native gas (18-dec) as display strings. */
export async function readBalances(
  address: Address
): Promise<{ usdc: string; gas: string }> {
  const client = arcReadClient();
  const [bal, native] = await Promise.all([
    client.readContract({
      address: getAddress(arc.usdcAddress),
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [getAddress(address)],
    }) as Promise<bigint>,
    client.getBalance({ address: getAddress(address) }),
  ]);
  return { usdc: formatUnits(bal, 6), gas: formatEther(native) };
}

