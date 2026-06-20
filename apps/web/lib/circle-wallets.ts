/**
 * Circle User-Controlled Wallets — server side.
 *
 * Non-custodial embedded wallets: Circle generates an MPC-secured wallet the
 * USER custodies via a PIN they set on the device (no app download). We use our
 * own `users.id` as the Circle `userId`, so every account maps 1:1 to a Circle
 * user. The backend never holds the key; it can only read addresses and create
 * *challenges* that the frontend Web SDK executes with the user's PIN.
 *
 * Only CIRCLE_API_KEY is needed here (no entity secret — that's for
 * developer-controlled wallets). The public App ID lives on the client.
 *
 * Admins are NEVER provisioned an embedded wallet — they sign with an external
 * wallet. Enforcement lives in the route handlers, not here.
 */
import {
  initiateUserControlledWalletsClient,
  type CircleUserControlledWalletsClient,
} from "@circle-fin/user-controlled-wallets";

/** Arc testnet identifier in Circle's blockchain enum. */
export const CIRCLE_ARC = "ARC-TESTNET";

let client: CircleUserControlledWalletsClient | null = null;
let warnedKeyShape = false;

/**
 * Circle keys generated after May 2023 have THREE colon-separated parts:
 * `<ENV>:<id>:<secret>` (e.g. `TEST_API_KEY:abc…:def…`). A key stored without
 * the environment prefix (just `<id>:<secret>`) makes the SDK throw a 401
 * "malformed API key" — which surfaced as a bare 500 on /api/wallet/embedded.
 * Normalize it here so a missing prefix doesn't take down provisioning.
 */
function normalizeApiKey(raw: string): string {
  const key = raw.trim();
  if (/^(TEST|LIVE)_API_KEY:/.test(key)) return key;
  // Two-part `id:secret` → assume testnet and prepend the prefix.
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

/** Lazily build the Circle client. Throws a clear error if the key is missing. */
export function circle(): CircleUserControlledWalletsClient {
  if (client) return client;
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) throw new Error("CIRCLE_API_KEY is not set — required for embedded wallets.");
  client = initiateUserControlledWalletsClient({ apiKey: normalizeApiKey(apiKey) });
  return client;
}

/** True when embedded wallets are configured (key + public App ID present). */
export function embeddedWalletsEnabled(): boolean {
  return !!process.env.CIRCLE_API_KEY && !!process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
}

/**
 * Ensure a Circle user exists for our userId. `createUser` is effectively
 * idempotent for our purposes — a duplicate returns a 409 we can ignore.
 */
export async function ensureCircleUser(userId: string): Promise<void> {
  try {
    await circle().createUser({ userId });
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e);
    // Already exists → fine. Re-throw anything else.
    if (!/already exist|409|duplicate/i.test(msg)) throw e;
  }
}

/** A short-lived (60-min) session token + encryption key for the Web SDK. */
export async function issueUserToken(
  userId: string
): Promise<{ userToken: string; encryptionKey: string }> {
  const res = await circle().createUserToken({ userId });
  const userToken = res.data?.userToken;
  const encryptionKey = res.data?.encryptionKey;
  if (!userToken || !encryptionKey) throw new Error("circle_token_failed");
  return { userToken, encryptionKey };
}

/**
 * Create the initialize-PIN + create-wallet challenge. The frontend Web SDK
 * executes the returned challengeId; the user sets a PIN and the SCA wallet is
 * created on Arc.
 */
export async function createWalletChallenge(userToken: string): Promise<string> {
  const res = await circle().createUserPinWithWallets({
    userToken,
    blockchains: [CIRCLE_ARC as never],
    accountType: "SCA",
  });
  const challengeId = res.data?.challengeId;
  if (!challengeId) throw new Error("circle_wallet_challenge_failed");
  return challengeId;
}

export interface EmbeddedWallet {
  id: string;
  address: string;
}

/** Read the user's first Arc wallet (id + address) — available server-side. */
export async function getEmbeddedWallet(userToken: string): Promise<EmbeddedWallet | null> {
  const res = await circle().listWallets({ userToken });
  const wallet = res.data?.wallets?.find((w) => !!w.address) ?? res.data?.wallets?.[0];
  if (!wallet?.id || !wallet?.address) return null;
  return { id: wallet.id, address: wallet.address };
}

/**
 * Confirm a destination address is valid for USDC on Arc before we let a user
 * withdraw to it. Returns false on any rejection or API error (fail closed).
 */
export async function validateAddress(address: string): Promise<boolean> {
  try {
    const res = await circle().validateAddress({
      address,
      blockchain: CIRCLE_ARC as never,
    });
    return res.data?.isValid === true;
  } catch {
    return false;
  }
}

/**
 * Create a USDC transfer (withdrawal) challenge from the user's embedded wallet
 * to an external address. The frontend executes the returned challengeId with
 * the user's PIN; Circle broadcasts the transfer. Returns the challengeId and
 * the transaction id (for status polling). `amountUsdc` is a decimal string.
 */
export async function createTransferChallenge(input: {
  userToken: string;
  walletId: string;
  destinationAddress: string;
  amountUsdc: string;
  idempotencyKey: string;
}): Promise<{ challengeId: string }> {
  const res = await circle().createTransaction({
    userToken: input.userToken,
    idempotencyKey: input.idempotencyKey,
    walletId: input.walletId,
    destinationAddress: input.destinationAddress,
    tokenAddress: process.env.NEXT_PUBLIC_USDC_ADDRESS || "",
    blockchain: CIRCLE_ARC as never,
    amounts: [input.amountUsdc],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  } as never);
  const challengeId = res.data?.challengeId;
  if (!challengeId) throw new Error("circle_transfer_challenge_failed");
  return { challengeId };
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

/** Map a Circle Transaction (loosely typed) into our small WalletTx shape. */
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

/** List the embedded wallet's on-chain transactions (for outgoing history). */
export async function listWalletTransactions(userToken: string, walletId: string): Promise<WalletTx[]> {
  try {
    const res = await circle().listTransactions({ userToken, walletIds: [walletId] } as never);
    const txs = (res.data?.transactions ?? []) as unknown as Array<Record<string, unknown>>;
    return txs.map((t) => toWalletTx(t));
  } catch {
    return [];
  }
}

/** Read one transaction's current state (for withdrawal status polling). */
export async function getWalletTransaction(userToken: string, txId: string): Promise<WalletTx | null> {
  try {
    const res = await circle().getTransaction({ userToken, id: txId } as never);
    const t = res.data?.transaction as unknown as Record<string, unknown> | undefined;
    if (!t) return null;
    return toWalletTx(t, txId);
  } catch {
    return null;
  }
}

/**
 * Create a contract-execution challenge (approve / deposit / addDelegate). The
 * frontend executes it with the PIN; the SCA broadcasts the tx. Returns the
 * challengeId. ABI values come from the caller (Gateway/USDC constants).
 */
export async function createContractExecChallenge(input: {
  userToken: string;
  walletId: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: Array<string | number>;
}): Promise<string> {
  const res = await circle().createUserTransactionContractExecutionChallenge({
    userToken: input.userToken,
    walletId: input.walletId,
    contractAddress: input.contractAddress,
    abiFunctionSignature: input.abiFunctionSignature,
    abiParameters: input.abiParameters,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const challengeId = res.data?.challengeId;
  if (!challengeId) throw new Error("circle_contract_challenge_failed");
  return challengeId;
}
