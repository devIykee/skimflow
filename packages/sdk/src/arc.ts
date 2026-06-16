import type { Address } from "./types.js";

/**
 * Arc testnet + Circle Gateway configuration.
 *
 * Arc is Circle's stablecoin-native L1. Circle Gateway nanopayments use the
 * x402 protocol: the buyer signs an EIP-3009 authorization off-chain (zero gas)
 * and Gateway batches many authorizations into a single on-chain settlement.
 *
 * The official SDK (`@circle-fin/x402-batching`) abstracts the chain config —
 * you pass the named chain `"arcTestnet"` and it knows the chain id, USDC
 * address, and Gateway wallet. We mirror that here and keep everything env-
 * driven so the same code runs live (real testnet USDC) or in local simulation.
 *
 * Provision wallets + test USDC with the Circle CLI (`@circle-fin/cli`) and the
 * Canteen ARC CLI; see README → "Going live on Arc testnet".
 */
export interface ArcConfig {
  rpcUrl: string;
  chainId: number;
  /** Named chain understood by @circle-fin/x402-batching (e.g. "arcTestnet"). */
  circleChain: string;
  /** CAIP-2 network identifier, e.g. "eip155:<chainId>" (Circle x402 network). */
  networkCaip2: string;
  /** USDC ERC-20 on Arc testnet (the SDK resolves this from circleChain too). */
  usdcAddress: Address;
  /** Circle Gateway API host (testnet). */
  gatewayUrl: string;
  /** Settle x402 payment endpoint path. */
  settlePath: string;
  /** GatewayWalletBatched contract — EIP-712 verifyingContract for the sig. */
  gatewayWalletAddress?: Address;
  /** Deployed RevenueSplit contract; falls back to direct creator pay if unset. */
  revenueSplitAddress?: Address;
  /** When true, no network calls are made — payments settle in a local ledger. */
  simulate: boolean;
}

const ZERO: Address = "0x0000000000000000000000000000000000000000";

// Circle Gateway on Arc testnet (from @circle-fin/x402-batching CHAIN_CONFIGS).
const ARC_TESTNET_USDC: Address = "0x3600000000000000000000000000000000000000";
const TESTNET_GATEWAY_WALLET: Address = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

export function loadArcConfig(env: NodeJS.ProcessEnv = process.env): ArcConfig {
  // Live only when explicitly opted in AND a Gateway/RPC is configured.
  const simulate =
    (env.PAYMENTS_MODE ?? "simulate").toLowerCase() !== "live" ||
    (!env.ARC_RPC_URL && !env.CIRCLE_API_KEY);

  // Arc testnet: chain id 5042002 (matches viem's `arcTestnet` definition).
  const chainId = Number(env.ARC_CHAIN_ID ?? "5042002");

  return {
    rpcUrl: env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
    chainId,
    circleChain: env.CIRCLE_CHAIN ?? "arcTestnet",
    networkCaip2: env.ARC_NETWORK_CAIP2 ?? `eip155:${chainId}`,
    usdcAddress: (env.USDC_ADDRESS as Address) || ARC_TESTNET_USDC,
    // Circle Gateway nanopayments API (testnet host, no trailing /v1).
    gatewayUrl: env.CIRCLE_GATEWAY_URL || "https://gateway-api-testnet.circle.com",
    settlePath: env.CIRCLE_GATEWAY_SETTLE_PATH ?? "/v1/x402/settle",
    gatewayWalletAddress: (env.GATEWAY_WALLET_ADDRESS as Address) || TESTNET_GATEWAY_WALLET,
    // Treat an empty env var ("") as unset so callers can fall back to the
    // creator's wallet — `??` alone would let "" through.
    revenueSplitAddress: (env.REVENUE_SPLIT_ADDRESS || undefined) as Address | undefined,
    simulate,
  };
}

/** viem chain object for Arc testnet (used only in live mode). */
export function arcChain(cfg: ArcConfig) {
  return {
    id: cfg.chainId,
    name: "Arc Testnet",
    // Native gas token on Arc is USDC with 18 decimals (the ERC-20 USDC used
    // for content payments is a separate 6-decimal token).
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    blockExplorers: {
      default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
    },
    testnet: true,
  } as const;
}
