/**
 * Circle Gateway — official SDK buyer wrapper.
 *
 * The canonical Circle x402 batching pattern (see circlefin/arc-nanopayments):
 * the agent holds a funded buyer wallet, requests an x402-protected URL, and the
 * SDK transparently handles the 402 → EIP-3009 sign → retry, with Gateway
 * batching the gas-free settlement on Arc.
 *
 *   import { GatewayClient } from "@circle-fin/x402-batching/client";
 *   const client = new GatewayClient({ chain: "arcTestnet", privateKey });
 *   const { data, status } = await client.pay(url);
 *
 * Install: npm install @circle-fin/x402-batching
 * Provision a buyer wallet + test USDC with the Circle CLI (@circle-fin/cli).
 *
 * Dynamic import keeps the package optional — the simulate-mode demo runs
 * without it, and this throws a clear message if used live without it.
 */
import type { Hex } from "@linepay/sdk";

export interface CircleBuyer {
  pay(url: string): Promise<{ data: unknown; status: number }>;
  getBalances(): Promise<unknown>;
  deposit(amountUsdc: string): Promise<unknown>;
  withdraw(amountUsdc: string, opts?: { chain?: string }): Promise<unknown>;
  supports(url: string): Promise<unknown>;
}

export function circleNativeEnabled(): boolean {
  return (
    (process.env.PAYMENTS_MODE ?? "").toLowerCase() === "live" &&
    !!(process.env.BUYER_PRIVATE_KEY ?? process.env.AGENT_WALLET_PRIVATE_KEY)
  );
}

/** Construct the official Circle GatewayClient (live buyer). */
export async function getCircleBuyer(): Promise<CircleBuyer> {
  const privateKey = (process.env.BUYER_PRIVATE_KEY ??
    process.env.AGENT_WALLET_PRIVATE_KEY) as Hex | undefined;
  if (!privateKey) throw new Error("Set BUYER_PRIVATE_KEY (a funded Arc testnet wallet).");

  let mod: any;
  try {
    // Subpath export per Circle docs: "@circle-fin/x402-batching/client".
    mod = await import("@circle-fin/x402-batching/client");
  } catch {
    throw new Error(
      "Circle SDK not installed. Run: npm install @circle-fin/x402-batching (in apps/agent)."
    );
  }
  const GatewayClient = mod.GatewayClient ?? mod.default?.GatewayClient;
  if (!GatewayClient) throw new Error("GatewayClient export not found in @circle-fin/x402-batching/client.");

  return new GatewayClient({
    chain: process.env.CIRCLE_CHAIN ?? "arcTestnet",
    privateKey,
  }) as CircleBuyer;
}
