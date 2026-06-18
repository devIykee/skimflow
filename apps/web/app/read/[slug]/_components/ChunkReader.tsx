"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useSignTypedData, useSwitchChain } from "wagmi";
import { readContract, writeContract, waitForTransactionReceipt } from "@wagmi/core";
import { erc20Abi } from "viem";
import { useToast } from "@/components/Toaster";
import { wagmiConfig } from "@/lib/wagmi";

const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");

const GATEWAY_WALLET_ABI = [
  {
    name: "availableBalance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "depositor", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function randomNonce(): `0x${string}` {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `0x${Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label}_timeout`)), ms))]);
}

interface ChunkView {
  id: string;
  blockIndex: number;
  isFree: boolean;
  text: string | null;
}

interface Props {
  slug: string;
  title: string;
  summary: string;
  creatorHandle: string | null;
  contentType: string;
  pricePerBlock: string;
  agentUrl: string | null;
  chunks: ChunkView[];
}

export default function ChunkReader(props: Props) {
  const { slug, title, summary, creatorHandle, pricePerBlock, chunks, agentUrl } = props;
  const storageKey = `linepay_reader_${slug}`;

  const [unlocked, setUnlocked] = useState<Record<number, string>>({});
  const [paying, setPaying] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const toast = useToast();

  // Hydrate unlocked chunks from localStorage so refresh keeps progress.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setUnlocked(JSON.parse(saved));
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const persist = (next: Record<number, string>) => {
    setUnlocked(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  };

  const payable = chunks.filter((c) => !c.isFree);
  const unlockedChunkIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of chunks) if (c.isFree || unlocked[c.blockIndex] !== undefined) set.add(c.id);
    return set;
  }, [chunks, unlocked]);
  const unlockedPayable = payable.filter((c) => unlockedChunkIds.has(c.id)).length;
  const nextLocked = payable.find((c) => !unlockedChunkIds.has(c.id));
  const spent = (unlockedPayable * Number(pricePerBlock)).toFixed(6);

  async function unlock(blockIndex: number) {
    if (!isConnected || !address) {
      toast("warning", "Connect your wallet to unlock this block.");
      return;
    }
    setPaying(blockIndex);
    setError(null);
    try {
      const quoteRes = await fetch(`/api/reader/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blockIndex }),
      });
      const quote = await quoteRes.json();
      if (quote.free) {
        persist({ ...unlocked, [blockIndex]: quote.text });
        return;
      }
      if (!quote.needsPayment) throw new Error(quote.friendly ?? quote.error ?? "Could not price this block.");

      if (chainId !== ARC_CHAIN_ID) {
        toast("info", "Approve the switch to Arc Testnet in your wallet…");
        await switchChainAsync({ chainId: ARC_CHAIN_ID });
      }

      const req = quote.requirements as {
        amount: string;
        payTo: `0x${string}`;
        asset: `0x${string}`;
        maxTimeoutSeconds: number;
        extra: { verifyingContract: `0x${string}` };
      };
      const amountWei = BigInt(req.amount);

      let gatewayBalance = 0n;
      try {
        gatewayBalance = await withTimeout(
          readContract(wagmiConfig, {
            address: req.extra.verifyingContract,
            abi: GATEWAY_WALLET_ABI,
            functionName: "availableBalance",
            args: [req.asset, address],
          }) as Promise<bigint>,
          4000,
          "gateway_balance"
        );
      } catch {
        gatewayBalance = 0n;
      }

      let d: { paid?: boolean; text?: string; amountDisplay?: string; friendly?: string; error?: string };
      if (gatewayBalance >= amountWei) {
        toast("info", "Sign to pay — gasless via Circle Gateway.");
        const now = Math.floor(Date.now() / 1000);
        const validAfter = (now - 600).toString();
        const validBefore = (now + Math.max(req.maxTimeoutSeconds, 7 * 24 * 3600 + 100)).toString();
        const nonce = randomNonce();
        const authorization = { from: address, to: req.payTo, value: req.amount, validAfter, validBefore, nonce };
        const signature = await signTypedDataAsync({
          domain: { name: "GatewayWalletBatched", version: "1", chainId: ARC_CHAIN_ID, verifyingContract: req.extra.verifyingContract },
          types: TRANSFER_WITH_AUTHORIZATION_TYPES,
          primaryType: "TransferWithAuthorization",
          message: { from: address, to: req.payTo, value: amountWei, validAfter: BigInt(validAfter), validBefore: BigInt(validBefore), nonce },
        });
        d = await (await fetch(`/api/reader/${slug}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ blockIndex, authorization, signature }),
        })).json();
      } else {
        toast("info", "Confirm the USDC payment in your wallet…");
        const hash = await writeContract(wagmiConfig, {
          address: req.asset,
          abi: erc20Abi,
          functionName: "transfer",
          args: [req.payTo, amountWei],
        });
        toast("info", "Payment sent — confirming on Arc…");
        await waitForTransactionReceipt(wagmiConfig, { hash });
        d = await (await fetch(`/api/reader/${slug}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ blockIndex, directTx: { hash, from: address } }),
        })).json();
      }

      if (d.paid && d.text != null) {
        persist({ ...unlocked, [blockIndex]: d.text });
        toast("success", `Unlocked block ${blockIndex}${d.amountDisplay ? ` · ${d.amountDisplay} USDC` : ""}.`);
      } else {
        throw new Error(d.friendly ?? d.error ?? "Payment could not be settled.");
      }
    } catch (e) {
      const msg = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
      if (/rejected|denied|cancell?ed/i.test(msg)) {
        toast("info", "Payment cancelled — nothing was charged.");
      } else {
        setError(msg);
        toast("error", msg, "Payment failed");
      }
    } finally {
      setPaying(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-margin-mobile py-stack-lg md:px-margin-desktop">
      <Link href="/marketplace" className="mb-6 inline-flex items-center gap-1 font-label-caps text-label-caps text-outline hover:text-primary">
        ← Marketplace
      </Link>

      <div className="mb-1 flex items-center gap-2">
        <span className="pill">{props.contentType}</span>
        {agentUrl && (
          <a href={agentUrl} className="font-data-mono text-[11px] text-primary" title="Agent endpoint">agent-skills.md</a>
        )}
      </div>
      <h1 className="font-display-lg text-display-lg-mobile">{title}</h1>
      <p className="mb-2 font-body-md text-on-surface-variant">
        by @{creatorHandle ?? "unknown"} · {pricePerBlock} USDC/block
      </p>

      {/* Progress */}
      <div className="mb-6 flex items-center gap-3 font-body-sm text-on-surface-variant">
        <span>{unlockedPayable} of {payable.length} blocks unlocked</span>
        <span>·</span>
        <span>spent {spent} USDC</span>
      </div>

      {summary && <p className="mb-8 border-l-4 border-outline-variant pl-4 font-body-lg text-on-surface-variant">{summary}</p>}

      <div className="flex flex-col gap-4">
        {chunks.map((c) => {
          const text = c.isFree ? c.text : unlocked[c.blockIndex];
          const isUnlocked = text !== undefined && text !== null;
          if (isUnlocked) {
            return (
              <article key={c.id} className="whitespace-pre-wrap font-body-lg text-body-lg leading-relaxed text-on-surface">
                {text}
              </article>
            );
          }
          const isNext = nextLocked?.id === c.id;
          return (
            <div key={c.id} className="relative overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low p-5">
              <div className="select-none blur-[5px]" aria-hidden>
                {"████ ██████ ████████ ███ ██████ █████ ████████ ██████ ███ █████ ████ ██████ ███████."}
              </div>
              {isNext && (
                <div className="mt-4 flex flex-col items-center gap-3 text-center">
                  <span className="flex items-center gap-1.5 font-label-caps text-label-caps text-outline"><span className="material-symbols-outlined text-[16px]">lock</span>Block {c.blockIndex} locked</span>
                  {!isConnected ? (
                    <ConnectButton />
                  ) : (
                    <button onClick={() => unlock(c.blockIndex)} disabled={paying !== null} className="btn-primary px-8 py-3">
                      {paying === c.blockIndex ? "Confirm in wallet…" : `Pay ${pricePerBlock} USDC to unlock`}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="mt-4 font-body-sm text-[13px] text-primary">{error}</p>}

      {payable.length > 0 && unlockedPayable === payable.length && (
        <div className="mt-8 flex items-center justify-center gap-2 rounded-xl border border-secondary/30 bg-secondary/5 p-6 text-center font-body-md text-secondary">
          <span className="material-symbols-outlined text-[20px]">check_circle</span>
          Fully unlocked — every block paid the creator directly.
        </div>
      )}
    </div>
  );
}
