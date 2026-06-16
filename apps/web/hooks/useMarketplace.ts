"use client";

import { useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWatchContractEvent,
} from "wagmi";
import { readContract, waitForTransactionReceipt } from "@wagmi/core";
import { formatUnits, parseUnits, type Address, type Hash } from "viem";
import { wagmiConfig } from "@/lib/wagmi";
import {
  AGENT_MARKETPLACE_ABI,
  ERC20_ABI,
  MARKETPLACE_ADDRESS,
  USDC_ADDRESS,
  marketplaceConfigured,
  type ContentRecord,
} from "@/lib/marketplaceAbi";

/**
 * All on-chain marketplace interactions. Real Wagmi/Viem reads, writes, and
 * event subscriptions — no mock data. Reads come straight from the contract;
 * the feed auto-refetches when ContentPublished / ContentPurchased fire.
 */

// ── USDC metadata (decimals are read on-chain; USDC = 6 but never hardcode) ──
export function useUsdcDecimals() {
  const { data } = useReadContract({
    abi: ERC20_ABI,
    address: USDC_ADDRESS,
    functionName: "decimals",
    query: { enabled: marketplaceConfigured, staleTime: Infinity },
  });
  return Number(data ?? 6);
}

export function useUsdcBalance() {
  const { address } = useAccount();
  const { data, refetch } = useReadContract({
    abi: ERC20_ABI,
    address: USDC_ADDRESS,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: marketplaceConfigured && !!address },
  });
  return { balance: (data as bigint | undefined) ?? 0n, refetch };
}

// ── The feed: read getAllContent, refetch on events ─────────────────────────
export function useAllContent() {
  const { data, isLoading, refetch, error } = useReadContract({
    abi: AGENT_MARKETPLACE_ABI,
    address: MARKETPLACE_ADDRESS,
    functionName: "getAllContent",
    query: { enabled: marketplaceConfigured },
  });

  // Live discovery — agents and the UI react to new publishes/purchases.
  useWatchContractEvent({
    abi: AGENT_MARKETPLACE_ABI,
    address: MARKETPLACE_ADDRESS,
    eventName: "ContentPublished",
    enabled: marketplaceConfigured,
    onLogs: () => refetch(),
  });
  useWatchContractEvent({
    abi: AGENT_MARKETPLACE_ABI,
    address: MARKETPLACE_ADDRESS,
    eventName: "ContentPurchased",
    enabled: marketplaceConfigured,
    onLogs: () => refetch(),
  });

  const content = ((data as readonly ContentRecord[] | undefined) ?? [])
    .filter((c) => c.active)
    .slice()
    .reverse(); // newest first

  return { content, isLoading, refetch, error };
}

// ── Access check for a single item ──────────────────────────────────────────
export function useHasAccess(id: bigint | undefined) {
  const { address } = useAccount();
  const { data, refetch } = useReadContract({
    abi: AGENT_MARKETPLACE_ABI,
    address: MARKETPLACE_ADDRESS,
    functionName: "hasAccess",
    args: id !== undefined && address ? [id, address] : undefined,
    query: { enabled: marketplaceConfigured && id !== undefined && !!address },
  });
  return { hasAccess: Boolean(data), refetch };
}

// ── Publish ──────────────────────────────────────────────────────────────────
export function usePublish() {
  const { writeContractAsync, isPending } = useWriteContract();

  /** priceUsd is a human dollar amount; converted to base units on-chain. */
  const publish = useCallback(
    async (cid: string, title: string, description: string, priceUsd: string, decimals: number) => {
      const price = parseUnits(priceUsd || "0", decimals);
      const hash = await writeContractAsync({
        abi: AGENT_MARKETPLACE_ABI,
        address: MARKETPLACE_ADDRESS,
        functionName: "publishContent",
        args: [cid, title, description, price],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash });
      return hash;
    },
    [writeContractAsync]
  );

  return { publish, isPending };
}

// ── Buy flow: allowance check → approve (if needed) → buyContent ─────────────
export type BuyStage = "idle" | "checking" | "approving" | "buying" | "done" | "error";

export function useBuyFlow() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const buy = useCallback(
    async (
      id: bigint,
      price: bigint,
      onStage?: (s: BuyStage, txHash?: Hash) => void
    ): Promise<Hash> => {
      if (!address) throw new Error("connect_wallet");
      onStage?.("checking");

      // 1) Read current allowance straight from the token contract.
      const allowance = (await readContract(wagmiConfig, {
        abi: ERC20_ABI,
        address: USDC_ADDRESS,
        functionName: "allowance",
        args: [address, MARKETPLACE_ADDRESS],
      })) as bigint;

      // 2) Approve only if needed.
      if (allowance < price) {
        onStage?.("approving");
        const approveHash = await writeContractAsync({
          abi: ERC20_ABI,
          address: USDC_ADDRESS,
          functionName: "approve",
          args: [MARKETPLACE_ADDRESS, price],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
      }

      // 3) Buy — pulls USDC buyer→author and records on-chain access.
      onStage?.("buying");
      const buyHash = await writeContractAsync({
        abi: AGENT_MARKETPLACE_ABI,
        address: MARKETPLACE_ADDRESS,
        functionName: "buyContent",
        args: [id],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: buyHash });
      onStage?.("done", buyHash);
      return buyHash;
    },
    [address, writeContractAsync]
  );

  return { buy };
}

/** Faucet helper for MockUSDC on testnets (no-op message if real USDC). */
export function useFaucet() {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const mint = useCallback(
    async (amountUsd: string, decimals: number) => {
      if (!address) throw new Error("connect_wallet");
      const hash = await writeContractAsync({
        abi: ERC20_ABI,
        address: USDC_ADDRESS,
        functionName: "faucet",
        args: [address, parseUnits(amountUsd || "100", decimals)],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash });
      return hash;
    },
    [address, writeContractAsync]
  );
  return { mint, isPending };
}

// ── formatting helper ─────────────────────────────────────────────────────────
export function fmtUsdc(amount: bigint, decimals: number) {
  return `$${formatUnits(amount, decimals)}`;
}

export { marketplaceConfigured, MARKETPLACE_ADDRESS, USDC_ADDRESS };
export type { ContentRecord, Address };
