import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Circle Arc Testnet — plug your values in via apps/web/.env.local:
 *
 *   NEXT_PUBLIC_ARC_CHAIN_ID      5042002         (Arc testnet chain id)
 *   NEXT_PUBLIC_ARC_RPC_URL       https://rpc.testnet.arc.network
 *   NEXT_PUBLIC_ARC_EXPLORER_URL  https://testnet.arcscan.app
 *   NEXT_PUBLIC_WC_PROJECT_ID     WalletConnect project id (cloud.walletconnect.com)
 *   NEXT_PUBLIC_USDC_ADDRESS      ERC-20 USDC on Arc (6 decimals)
 *   NEXT_PUBLIC_MARKETPLACE_ADDRESS  deployed AgentMarketplace address
 *
 * Note on native currency: Arc uses USDC for gas. `decimals: 18` here governs
 * only the wallet's gas display/estimation; on-chain USDC *payments* use the
 * 6-decimal ERC-20 at NEXT_PUBLIC_USDC_ADDRESS — that's separate.
 * ─────────────────────────────────────────────────────────────────────────────
 */
// Arc testnet: chain id 5042002, USDC-native gas. (Matches viem's `arcTestnet`.)
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");
const RPC_URL = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const EXPLORER_URL = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? "https://testnet.arcscan.app";
// `||` (not `??`) so an empty-string env var falls back too. RainbowKit's
// getDefaultConfig throws on a missing/empty projectId. The placeholder keeps
// the app booting with injected wallets (MetaMask); WalletConnect's mobile/QR
// connector needs a REAL id from https://dashboard.reown.com (free).
const WC_PROJECT_ID =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID || "00000000000000000000000000000000";

export const arcTestnet = defineChain({
  id: CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "Arc Gas USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: EXPLORER_URL },
  },
  testnet: true,
});

/**
 * Wagmi + RainbowKit config. `ssr: true` is required for Next.js App Router so
 * the wallet state hydrates correctly.
 */
export const wagmiConfig = getDefaultConfig({
  appName: "LinePay Agent Marketplace",
  projectId: WC_PROJECT_ID,
  chains: [arcTestnet],
  ssr: true,
});
