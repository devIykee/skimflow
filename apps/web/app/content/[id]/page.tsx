"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useSignTypedData, useSwitchChain } from "wagmi";
import { readContract, writeContract, waitForTransactionReceipt } from "@wagmi/core";
import { erc20Abi } from "viem";
import { useToast } from "@/components/Toaster";
import { wagmiConfig } from "@/lib/wagmi";

const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");

// GatewayWallet.availableBalance(token, depositor) — how much the wallet has
// deposited into Circle Gateway (gasless settlement draws from this).
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

// EIP-3009 TransferWithAuthorization, signed against Circle's GatewayWalletBatched
// domain — exactly what @circle-fin/x402-batching signs for gasless batched settle.
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

/** Reject after `ms` so a hung RPC read can't freeze the Pay button. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label}_timeout`)), ms)),
  ]);
}

interface Meta {
  id: string; kind: string; title: string; summary: string; tags: string[];
  creator: string; verified: boolean; lineCount: number; freeLines: number;
  pricePerLine: string; pricePerLineDisplay: string; preview: string;
}

function usd(baseUnits: number) {
  return `$${(baseUnits / 1_000_000).toFixed(6)}`;
}

const CODE_KINDS = ["agent-skill", "prompt-template", "knowledge-base"];

/**
 * Per-item reader for the x402 nanopayment flow. Articles render as editorial
 * prose; agent-skills / prompts / knowledge bases render as a locked code block
 * with blurred lines past the free preview. Each "unlock" is a real per-line
 * payment (simulate mode by default; real USDC on Arc when PAYMENTS_MODE=live).
 */
export default function ContentReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [unlocked, setUnlocked] = useState<string[]>([]); // unlocked chunks (text)
  const [readTo, setReadTo] = useState(0);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<{ amount: string; txHash: string }[]>([]);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const toast = useToast();

  useEffect(() => {
    fetch(`/api/content/${id}/meta`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m: Meta) => { setMeta(m); setReadTo(m.freeLines); })
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) return <Centered>Content not found. <Link className="text-primary" href="/read">Back to library</Link></Centered>;
  if (!meta) return <Centered>Loading…</Centered>;

  const isCode = CODE_KINDS.includes(meta.kind);
  const chunk = isCode ? 8 : 12;
  const remaining = meta.lineCount - readTo;
  const nextEnd = Math.min(meta.lineCount, readTo + chunk);
  const nextCount = nextEnd - readTo;
  const nextCost = nextCount * Number(meta.pricePerLine);

  async function unlockNext() {
    if (!isConnected || !address) {
      setError("Connect your wallet to pay.");
      toast("warning", "Connect your wallet to unlock paid lines.");
      return;
    }
    setPaying(true);
    setError(null);
    try {
      const lineStart = readTo + 1;
      const lineEnd = nextEnd;

      // Phase 1 — quote: the server tells us exactly what to sign.
      console.info("[pay] requesting quote", { id, lineStart, lineEnd });
      const quoteRes = await fetch(`/api/reader/${id}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineStart, lineEnd }),
      });
      const quote = await quoteRes.json();
      console.info("[pay] quote", quote);
      if (quote.free) {
        setUnlocked((u) => [...u, quote.text]);
        setReadTo(quote.lineEnd);
        return;
      }
      if (!quote.needsPayment) {
        throw new Error(quote.friendly ?? quote.detail ?? quote.error ?? "Could not price this unlock.");
      }

      // Make sure the wallet is on Arc testnet before signing.
      console.info("[pay] current chainId", chainId, "want", ARC_CHAIN_ID);
      if (chainId !== ARC_CHAIN_ID) {
        toast("info", "Approve the network switch to Arc Testnet in your wallet…");
        try {
          await switchChainAsync({ chainId: ARC_CHAIN_ID });
          console.info("[pay] switched to Arc");
        } catch (e) {
          throw new Error("Please switch your wallet to Arc Testnet (5042002) to pay, then click again.");
        }
      }

      const req = quote.requirements as {
        amount: string; payTo: `0x${string}`; asset: `0x${string}`; maxTimeoutSeconds: number;
        extra: { verifyingContract: `0x${string}` };
      };
      const amountWei = BigInt(req.amount);

      // Pick the rail: gasless Circle Gateway if the wallet already has a
      // deposited balance; otherwise a one-popup direct USDC transfer. The
      // balance read is best-effort + time-boxed — if Arc's RPC is slow or the
      // contract isn't reachable we just fall back to the direct transfer
      // rather than freezing the button.
      let gatewayBalance = 0n;
      try {
        gatewayBalance = (await withTimeout(
          readContract(wagmiConfig, {
            address: req.extra.verifyingContract,
            abi: GATEWAY_WALLET_ABI,
            functionName: "availableBalance",
            args: [req.asset, address],
          }) as Promise<bigint>,
          4000,
          "gateway_balance"
        ));
      } catch (e) {
        console.info("[pay] gateway balance read skipped:", String((e as any)?.message ?? e));
        gatewayBalance = 0n;
      }
      console.info("[pay] gatewayBalance", gatewayBalance.toString(), "amount", amountWei.toString());

      let d: any;
      if (gatewayBalance >= amountWei) {
        // ── Gasless Gateway path ──────────────────────────────────────────────
        toast("info", "Sign to pay — gasless via Circle Gateway.");
        const now = Math.floor(Date.now() / 1000);
        const SEVEN_DAYS = 7 * 24 * 60 * 60 + 100;
        const validAfter = (now - 600).toString();
        const validBefore = (now + Math.max(req.maxTimeoutSeconds, SEVEN_DAYS)).toString();
        const nonce = randomNonce();
        const authorization = {
          from: address as `0x${string}`,
          to: req.payTo,
          value: req.amount,
          validAfter,
          validBefore,
          nonce,
        };
        const signature = await signTypedDataAsync({
          domain: {
            name: "GatewayWalletBatched",
            version: "1",
            chainId: ARC_CHAIN_ID,
            verifyingContract: req.extra.verifyingContract,
          },
          types: TRANSFER_WITH_AUTHORIZATION_TYPES,
          primaryType: "TransferWithAuthorization",
          message: {
            from: authorization.from,
            to: authorization.to,
            value: amountWei,
            validAfter: BigInt(validAfter),
            validBefore: BigInt(validBefore),
            nonce,
          },
        });
        const settleRes = await fetch(`/api/reader/${id}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ lineStart, lineEnd, authorization, signature }),
        });
        d = await settleRes.json();
      } else {
        // ── Direct USDC transfer path (no deposit needed, one popup) ──────────
        // Best-effort balance pre-check — if the read is slow/unreachable we
        // skip it and let the wallet reject an underfunded transfer instead.
        try {
          const usdcBalance = await withTimeout(
            readContract(wagmiConfig, {
              address: req.asset, abi: erc20Abi, functionName: "balanceOf", args: [address],
            }) as Promise<bigint>,
            4000,
            "usdc_balance"
          );
          console.info("[pay] usdcBalance", usdcBalance.toString());
          if (usdcBalance < amountWei) {
            throw new Error(
              "You need testnet USDC on Arc to pay. Get some free at faucet.circle.com (select Arc Testnet), then try again."
            );
          }
        } catch (e: any) {
          if (/faucet\.circle\.com/.test(String(e?.message))) throw e; // real insufficiency
          console.info("[pay] balance pre-check skipped:", String(e?.message ?? e));
        }
        toast("info", "Confirm the USDC payment in your wallet…");
        console.info("[pay] sending direct transfer", { to: req.payTo, amount: amountWei.toString() });
        const hash = await writeContract(wagmiConfig, {
          address: req.asset, abi: erc20Abi, functionName: "transfer", args: [req.payTo, amountWei],
        });
        toast("info", "Payment sent — confirming on Arc…");
        await waitForTransactionReceipt(wagmiConfig, { hash });
        console.info("[pay] transfer confirmed", hash);
        const settleRes = await fetch(`/api/reader/${id}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ lineStart, lineEnd, directTx: { hash, from: address } }),
        });
        d = await settleRes.json();
      }

      if (d.paid) {
        setUnlocked((u) => [...u, d.text]);
        setReadTo(d.lineEnd);
        setReceipts((r) => [...r, { amount: d.amountDisplay, txHash: d.txHash }]);
        toast("success", `Paid ${d.amountDisplay} to @${meta!.creator} — ${d.lineCount} lines unlocked.`, "Settled on Arc");
        // Gentle nudge: depositing once makes every future unlock gasless.
        if (d.method === "direct") {
          toast("info", "Tip: deposit USDC into Circle Gateway once to make future unlocks gasless.");
        }
      } else {
        throw new Error(d.friendly ?? d.detail ?? d.error ?? "Payment could not be settled.");
      }
    } catch (e: any) {
      const msg = String(e?.shortMessage ?? e?.message ?? e);
      // User rejected the signature in their wallet — not an error worth shouting.
      if (/rejected|denied|User rejected|cancell?ed/i.test(msg)) {
        setError("Signature cancelled.");
        toast("info", "Payment cancelled — nothing was charged.");
      } else {
        setError(msg);
        toast("error", msg, "Payment failed");
      }
    } finally {
      setPaying(false);
    }
  }

  const previewLines = meta.preview.split("\n");
  const unlockedLines = unlocked.join("\n").split("\n").filter((_, i, a) => !(i === 0 && a.length > 1 && a[0] === ""));

  return (
    <div className="mx-auto max-w-3xl px-margin-mobile py-stack-lg md:px-margin-desktop">
      <Link href="/read" className="mb-6 flex items-center gap-1 font-label-caps text-label-caps text-outline hover:text-primary">
        <span className="material-symbols-outlined text-[16px]">arrow_back</span> Library
      </Link>

      <div className="mb-2 flex items-center gap-2">
        <span className="pill">{meta.kind}</span>
        {meta.verified && (
          <span className="flex items-center gap-1 font-label-caps text-label-caps text-secondary">
            <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>verified
          </span>
        )}
      </div>
      <h1 className="font-display-lg text-display-lg-mobile">{meta.title}</h1>
      <p className="mb-8 font-body-md text-on-surface-variant">by @{meta.creator} · {meta.pricePerLineDisplay}/line · {meta.lineCount} lines</p>

      {/* Reading surface */}
      {isCode ? (
        <CodeBlock previewLines={previewLines} unlockedLines={unlockedLines} lockedCount={remaining} />
      ) : (
        <ProseBlock preview={meta.preview} unlocked={unlocked} lockedCount={remaining} />
      )}

      {receipts.length > 0 && (
        <div className="mt-stack-md space-y-1">
          {receipts.map((r, i) => (
            <div key={i} className="flex items-center gap-2 font-body-sm text-secondary">
              <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>payments</span>
              Paid {r.amount} to @{meta.creator} · <span className="font-data-mono text-[11px]">{r.txHash.slice(0, 16)}…</span>
            </div>
          ))}
        </div>
      )}

      {/* Unlock control */}
      {remaining > 0 ? (
        <div className="mt-stack-lg rounded-xl border border-outline-variant bg-surface-container-low p-stack-lg text-center">
          <div className="mb-2 flex items-center justify-center gap-1 font-label-caps text-label-caps text-outline">
            <span className="material-symbols-outlined text-[16px]">lock</span> {remaining} more {isCode ? "lines of code/prompt" : "lines"}
          </div>
          <p className="mb-4 font-body-md text-on-surface-variant">
            Unlock the next {nextCount} for <strong className="text-primary">{usd(Math.round(nextCost))}</strong>
            <span className="ml-1 text-outline">· USDC on Arc · gasless once you fund Circle Gateway</span>
          </p>
          {!isConnected ? (
            <div className="flex justify-center"><ConnectButton /></div>
          ) : (
            <button className="btn-primary px-8 py-3" onClick={unlockNext} disabled={paying}>
              <span className="material-symbols-outlined text-[18px]">bolt</span>
              {paying ? "Confirm in your wallet…" : `Pay & unlock ${nextCount}`}
            </button>
          )}
          {error && (
            <p className="mt-3 font-body-sm text-[13px] text-primary">{error}</p>
          )}
        </div>
      ) : (
        <div className="mt-stack-lg rounded-xl border border-secondary/30 bg-secondary/5 p-stack-lg text-center font-body-md text-secondary">
          ✓ Fully unlocked — every line paid the creator directly.
        </div>
      )}
    </div>
  );
}

// ── Article prose ─────────────────────────────────────────────────────────────
function ProseBlock({ preview, unlocked, lockedCount }: { preview: string; unlocked: string[]; lockedCount: number }) {
  return (
    <article className="whitespace-pre-wrap font-body-lg text-body-lg leading-relaxed text-on-surface">
      {preview}
      {unlocked.map((u, i) => <span key={i}>{"\n" + u}</span>)}
      {lockedCount > 0 && <BlurredProse count={Math.min(lockedCount, 6)} />}
    </article>
  );
}

function BlurredProse({ count }: { count: number }) {
  return (
    <div className="relative mt-2 select-none" aria-hidden>
      <div className="blur-[5px]">
        {Array.from({ length: count }).map((_, i) => (
          <p key={i} className="font-body-lg text-body-lg text-on-surface-variant">
            {"████ ██████ ████████ ███ ██████ █████ ████████ ██████ ███ █████.".slice(0, 30 + ((i * 13) % 30))}
          </p>
        ))}
      </div>
    </div>
  );
}

// ── Code / prompt / knowledge: locked code block ─────────────────────────────
function CodeBlock({ previewLines, unlockedLines, lockedCount }: { previewLines: string[]; unlockedLines: string[]; lockedCount: number }) {
  const open = previewLines.concat(unlockedLines.filter((l) => l !== ""));
  return (
    <div className="overflow-hidden rounded-xl border border-on-surface/15 bg-[#0b0c10] font-data-mono text-[13px] leading-relaxed">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2 text-white/50">
        <span className="h-3 w-3 rounded-full bg-[#ff5f56]" /><span className="h-3 w-3 rounded-full bg-[#ffbd2e]" /><span className="h-3 w-3 rounded-full bg-[#27c93f]" />
        <span className="ml-2 text-[11px]">skill.md</span>
      </div>
      <div className="overflow-x-auto p-4 text-[#e4e2dd]">
        {open.map((line, i) => (
          <div key={i} className="flex gap-4">
            <span className="select-none text-white/25">{String(i + 1).padStart(3, "0")}</span>
            <span className="whitespace-pre">{line || " "}</span>
          </div>
        ))}
        {lockedCount > 0 && (
          <div className="relative mt-1">
            <div className="select-none blur-[4px]" aria-hidden>
              {Array.from({ length: Math.min(lockedCount, 8) }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <span className="text-white/25">{String(open.length + i + 1).padStart(3, "0")}</span>
                  <span className="whitespace-pre text-white/40">{"const ██████ = ████(████, ███);  // ██████████".slice(0, 22 + ((i * 7) % 24))}</span>
                </div>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex items-center gap-1 rounded-full bg-primary/90 px-3 py-1 text-[11px] font-bold text-white">
                <span className="material-symbols-outlined text-[14px]">lock</span> {lockedCount} locked lines
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl px-margin-mobile py-32 text-center font-body-md text-on-surface-variant md:px-margin-desktop">{children}</div>;
}
