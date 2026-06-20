/**
 * Human reader payment helpers — Circle Gateway settlement on Arc, ported
 * unchanged in spirit from the original line-based reader (payment signing
 * logic preserved per the constraints). Adapted to the chunk model: the amount
 * is price_per_block and payTo is the creator's validated wallet.
 */
import { createPublicClient, getAddress, http, parseEventLogs, erc20Abi } from "viem";
import { loadArcConfig, type Address } from "@skimflow/sdk";

export const arc = loadArcConfig();

const GATEWAY_WALLET = (process.env.GATEWAY_WALLET_ADDRESS ||
  process.env.CIRCLE_GATEWAY_ADDRESS ||
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9") as Address;
const NETWORK = process.env.ARC_NETWORK_CAIP2 || "eip155:5042002";
const MAX_TIMEOUT_SECONDS = 600;

export function arcPublicClient() {
  return createPublicClient({
    chain: {
      id: arc.chainId,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [arc.rpcUrl] } },
    } as never,
    transport: http(arc.rpcUrl),
  });
}

/** x402 PaymentRequirements in Circle's batching shape. */
export function batchingRequirements(amount: string, payTo: Address) {
  return {
    scheme: "exact",
    network: NETWORK,
    asset: getAddress(arc.usdcAddress),
    amount,
    payTo: getAddress(payTo),
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: getAddress(GATEWAY_WALLET),
    },
  };
}

export interface CircleSettleResponse {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  errorReason?: string;
}

/** Settle through Circle Gateway's batched facilitator (POST /v1/x402/settle). */
export async function settleViaCircle(
  paymentPayload: unknown,
  paymentRequirements: unknown
): Promise<CircleSettleResponse> {
  const url = `${arc.gatewayUrl.replace(/\/$/, "")}/v1/x402/settle`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentPayload, paymentRequirements }),
  });
  const text = await res.text();
  if (!text) throw new Error(`gateway_empty_response:${res.status}`);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`gateway_bad_response:${res.status}:${text.slice(0, 200)}`);
  }
  if (typeof data !== "object" || data === null || !("success" in data)) {
    throw new Error(`gateway_settle_failed:${res.status}:${text.slice(0, 200)}`);
  }
  return data as CircleSettleResponse;
}

/** Verify a direct on-chain USDC transfer paid `payTo` at least `amount`. */
export async function verifyDirectTransfer(
  hash: `0x${string}`,
  payTo: Address,
  amount: string
): Promise<{ ok: boolean; payer?: Address; reason?: string }> {
  let receipt;
  try {
    receipt = await arcPublicClient().getTransactionReceipt({ hash });
  } catch {
    return { ok: false, reason: "tx_not_found" };
  }
  if (receipt.status !== "success") return { ok: false, reason: "tx_reverted" };
  const usdc = getAddress(arc.usdcAddress);
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
  const match = transfers.find(
    (l) =>
      getAddress(l.address) === usdc &&
      getAddress(l.args.to as Address) === getAddress(payTo) &&
      (l.args.value as bigint) >= BigInt(amount)
  );
  if (!match) return { ok: false, reason: "transfer_mismatch" };
  return { ok: true, payer: getAddress(match.args.from as Address) };
}

export function friendlyError(raw: string): string {
  const r = (raw || "").toLowerCase();
  if (/insufficient|balance|funds/.test(r))
    return "Insufficient Gateway balance. Deposit more test USDC into your Circle Gateway balance, then try again.";
  if (/expired|valid_?before|too late/.test(r)) return "The signed authorization expired. Please sign again.";
  if (/nonce|already|replay|used/.test(r)) return "This authorization was already used. Click Pay again to sign a fresh one.";
  if (/signature|invalid_?sig|recover/.test(r)) return "The signature didn't validate for Arc testnet. Make sure your wallet is on Arc Testnet (5042002).";
  if (/network|chain|unsupported/.test(r)) return "Unsupported network. Switch your wallet to Arc Testnet (5042002).";
  if (/recipient|payto|address/.test(r)) return "The creator's payout address is invalid.";
  return raw || "Payment could not be settled.";
}
