/**
 * Circle Developer-Controlled Wallets — server side.
 *
 * Custodial wallets the PLATFORM controls via an encrypted entity secret. We
 * auto-provision one SCA wallet on Arc for every (non-admin) user at signup, so
 * there is no PIN, no challenge, and no client SDK — every signing operation
 * (deposit/delegate for silent-pay, withdrawals) happens server-side here.
 *
 * Requires CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET (32-byte hex, registered with
 * Circle) and a CIRCLE_WALLET_SET_ID that owns all user wallets (create once via
 * scripts/circle-create-walletset.mjs).
 *
 * Admins are NEVER provisioned a wallet — they sign with an external wallet.
 * Enforcement lives in the route handlers / signup, not here.
 */
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

/** Arc testnet identifier in Circle's blockchain enum. */
export const CIRCLE_ARC = "ARC-TESTNET";

/** USDC token address on Arc (6 decimals), used to pick the right balance/token. */
const USDC_ADDRESS = (
  process.env.NEXT_PUBLIC_USDC_ADDRESS ||
  process.env.USDC_ADDRESS ||
  ""
).toLowerCase();

type DevWalletsClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

let client: DevWalletsClient | null = null;
let warnedKeyShape = false;

/**
 * Circle keys generated after May 2023 have THREE colon-separated parts:
 * `<ENV>:<id>:<secret>`. A key stored without the environment prefix makes the
 * SDK throw a 401 "malformed API key". Normalize it so a missing prefix doesn't
 * take down provisioning.
 */
function normalizeApiKey(raw: string): string {
  const key = raw.trim();
  if (/^(TEST|LIVE)_API_KEY:/.test(key)) return key;
  if (key.split(":").length === 2) {
    if (!warnedKeyShape) {
      console.warn(
        "[circle] CIRCLE_API_KEY is missing its environment prefix; assuming TEST_API_KEY:. " +
          "Set the full 3-part key (TEST_API_KEY:id:secret) in .env and Vercel."
      );
      warnedKeyShape = true;
    }
    return `TEST_API_KEY:${key}`;
  }
  return key;
}

/** Lazily build the developer-controlled client. Throws if credentials are missing. */
export function circle(): DevWalletsClient {
  if (client) return client;
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey) throw new Error("CIRCLE_API_KEY is not set — required for wallets.");
  if (!entitySecret)
    throw new Error("CIRCLE_ENTITY_SECRET is not set — required for developer-controlled wallets.");
  client = initiateDeveloperControlledWalletsClient({
    apiKey: normalizeApiKey(apiKey),
    entitySecret,
  });
  return client;
}

/** True when developer-controlled wallets are fully configured. */
export function walletsEnabled(): boolean {
  return (
    !!process.env.CIRCLE_API_KEY &&
    !!process.env.CIRCLE_ENTITY_SECRET &&
    !!process.env.CIRCLE_WALLET_SET_ID
  );
}

export interface ProvisionedWallet {
  id: string;
  address: string;
}

/**
 * Provision ONE SCA wallet on Arc inside our wallet set. Custodial — the user
 * never sees a key or a PIN. Returns the Circle wallet id + on-chain address to
 * persist against the user.
 */
export async function provisionWallet(): Promise<ProvisionedWallet> {
  const walletSetId = process.env.CIRCLE_WALLET_SET_ID;
  if (!walletSetId)
    throw new Error("CIRCLE_WALLET_SET_ID is not set — run scripts/circle-create-walletset.mjs.");
  const res = await circle().createWallets({
    accountType: "SCA",
    blockchains: [CIRCLE_ARC as never],
    count: 1,
    walletSetId,
  });
  const wallet = res.data?.wallets?.[0];
  if (!wallet?.id || !wallet?.address) throw new Error("circle_wallet_create_failed");
  return { id: wallet.id, address: wallet.address };
}

/**
 * Find the wallet's USDC token-balance entry (carries Circle's `token.id` and
 * the decimal `amount`). Uses the balance endpoint — NEVER getWallet, which
 * never returns balances. Returns null when the wallet doesn't hold USDC yet.
 */
async function findUsdcBalance(
  walletId: string
): Promise<{ tokenId: string | undefined; amount: string } | null> {
  const res = await circle().getWalletTokenBalance({ id: walletId });
  const balances = res.data?.tokenBalances ?? [];
  const usdc = balances.find((b) => {
    const sym = b.token?.symbol?.toUpperCase();
    const addr = b.token?.tokenAddress?.toLowerCase();
    return sym === "USDC" || (!!USDC_ADDRESS && addr === USDC_ADDRESS);
  });
  if (!usdc) return null;
  return { tokenId: usdc.token?.id, amount: usdc.amount ?? "0" };
}

/** The wallet's spendable USDC balance (decimal string); "0" if none held. */
export async function getUsdcBalance(walletId: string): Promise<string> {
  return (await findUsdcBalance(walletId))?.amount ?? "0";
}

export interface WalletTx {
  id: string;
  state: string;
  amounts?: string[];
  destinationAddress?: string;
  sourceAddress?: string;
  txHash?: string;
  createDate?: string;
  operation?: string;
}

function toWalletTx(t: Record<string, unknown>, fallbackId = ""): WalletTx {
  return {
    id: String(t.id ?? fallbackId),
    state: String(t.state ?? ""),
    amounts: (t.amounts as string[]) ?? undefined,
    destinationAddress: t.destinationAddress as string | undefined,
    sourceAddress: t.sourceAddress as string | undefined,
    txHash: t.txHash as string | undefined,
    createDate: t.createDate as string | undefined,
    operation: t.operation as string | undefined,
  };
}

/**
 * Create a USDC transfer (withdrawal) from a user's wallet to an external
 * address. Signed server-side with the entity secret; settles asynchronously.
 * Returns the Circle transaction id for status polling. `amountUsdc` is decimal.
 */
export async function transferUsdc(input: {
  walletId: string;
  destinationAddress: string;
  amountUsdc: string;
  idempotencyKey: string;
}): Promise<{ id: string }> {
  // Transfer by Circle's tokenId (not tokenAddress): tokenAddress must be paired
  // with a blockchain, and Circle rejects it otherwise ("API parameter invalid").
  // tokenId is unambiguous and needs nothing else.
  const usdc = await findUsdcBalance(input.walletId);
  if (!usdc?.tokenId) throw new Error("No USDC balance found in this wallet to withdraw.");
  const res = await circle().createTransaction({
    walletId: input.walletId,
    tokenId: usdc.tokenId,
    destinationAddress: input.destinationAddress,
    amounts: [input.amountUsdc],
    idempotencyKey: input.idempotencyKey,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } as never);
  const id = res.data?.id;
  if (!id) throw new Error("circle_transfer_failed");
  return { id };
}

/**
 * Execute a contract call (approve / deposit / addDelegate for silent-pay setup)
 * from a user's wallet. Signed server-side; no challenge. Returns the Circle
 * transaction id. ABI values come from the caller (Gateway/USDC constants).
 */
export async function execContract(input: {
  walletId: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: Array<string | number>;
  idempotencyKey: string;
}): Promise<{ id: string }> {
  const res = await circle().createContractExecutionTransaction({
    walletId: input.walletId,
    contractAddress: input.contractAddress,
    abiFunctionSignature: input.abiFunctionSignature,
    abiParameters: input.abiParameters,
    idempotencyKey: input.idempotencyKey,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } as never);
  const id = res.data?.id;
  if (!id) throw new Error("circle_contract_exec_failed");
  return { id };
}

/** Read one transaction's current state (for withdrawal/setup status polling). */
export async function getTx(txId: string): Promise<WalletTx | null> {
  try {
    const res = await circle().getTransaction({ id: txId });
    const t = res.data?.transaction as unknown as Record<string, unknown> | undefined;
    if (!t) return null;
    return toWalletTx(t, txId);
  } catch {
    return null;
  }
}

/** List a wallet's transactions (outgoing history). Best-effort. */
export async function listWalletTxs(walletId: string): Promise<WalletTx[]> {
  try {
    const res = await circle().listTransactions({ walletIds: [walletId] } as never);
    const txs = (res.data?.transactions ?? []) as unknown as Array<Record<string, unknown>>;
    return txs.map((t) => toWalletTx(t));
  } catch {
    return [];
  }
}
