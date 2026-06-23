"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useSignTypedData, useSwitchChain } from "wagmi";
import { readContract, writeContract, waitForTransactionReceipt } from "@wagmi/core";
import { erc20Abi } from "viem";
import type { Address } from "viem";
import { useToast } from "@/components/Toaster";
import { wagmiConfig } from "@/lib/wagmi";
import { formatUsdc, wholePiecePrice } from "@/lib/money";
import { buildSessionPayment, loadSessionAccount } from "@/lib/session-key-client";
import { useEmbeddedWallet } from "@/lib/useEmbeddedWallet";
import PaySetupModal, { type PaySessionInfo } from "@/components/PaySetupModal";
import ReadingFuel, { PAY_SESSION_EVENT } from "@/components/ReadingFuel";
import RichText from "@/components/RichText";
import ShareButton from "@/components/ShareButton";
import ReportButton from "@/components/ReportButton";
import ShareAgentButton from "@/components/ShareAgentButton";

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
  /** Picture Skim-Flow: caption label (always shown); image URL rides in `text`. */
  caption?: string | null;
}

interface Props {
  slug: string;
  title: string;
  summary: string;
  creatorHandle: string | null;
  contentType: string;
  pricePerBlock: string;
  agentUrl: string | null;
  verifiedSource?: string | null;
  /** The viewer is this piece's creator (or an admin): read in full, free, with
   *  an Edit link and no paywall chrome. */
  isOwner?: boolean;
  chunks: ChunkView[];
}

export default function ChunkReader(props: Props) {
  const { slug, title, summary, creatorHandle, pricePerBlock, chunks, agentUrl } = props;
  const isPicture = props.contentType === "picture";
  const isOwner = props.isOwner ?? false;
  const storageKey = `skimflow_reader_${slug}`;
  // Reading-progress save point — the top-most block the reader had reached, so
  // we can drop them back there on return instead of at the top.
  const posKey = `skimflow_reader_pos_${slug}`;

  const [unlocked, setUnlocked] = useState<Record<number, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const savedPosRef = useRef<number | null>(null);
  const [paying, setPaying] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Silent-payment session state.
  const [sessionActive, setSessionActive] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [pendingBlock, setPendingBlock] = useState<number | null>(null);
  // §3 optimistic unlock: the last optimistically-unlocked block's payment token
  // (settled on the next unlock's combined check), and whether a combined check
  // failed (blocks further unlocking until resolved).
  const lastTokenRef = useRef<string | null>(null);
  const lastBlockRef = useRef<number | null>(null);
  const [blocked, setBlocked] = useState(false);
  // Whole-piece upsell: when setup is needed first, remember to buy the lot after.
  const [pendingWhole, setPendingWhole] = useState(false);

  const { address } = useAccount();
  const chainId = useChainId();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const toast = useToast();

  // Embedded (Circle) wallet — the default for signed-in users who didn't bring
  // their own. The silent-pay path works the same with either wallet; only the
  // external-only wallet fallback (doWalletPay) needs a wagmi signer.
  const embedded = useEmbeddedWallet();
  const embeddedAddr = embedded.status?.hasWallet ? (embedded.status.address as Address | null) : null;
  const effectiveWallet = (address ?? embeddedAddr ?? undefined) as Address | undefined;
  const walletKind: "external" | "embedded" | null = address ? "external" : embeddedAddr ? "embedded" : null;
  const hasWallet = !!effectiveWallet;
  // Embedded status loads async (null until the GET resolves). Until then we
  // don't know if the user has an embedded wallet — showing the external-only
  // Connect button in that window would wrongly prompt an embedded user to
  // connect MetaMask. Treat "unknown" as loading. An external (wagmi) address
  // is known synchronously, so a connected user is never blocked on this.
  const walletLoading = !address && embedded.status === null;
  // Admins always use an external wallet (no embedded provisioning offered).
  const canCreateEmbedded = embedded.status?.enabled === true && embedded.status?.isAdmin === false;

  // Hydrate unlocked chunks + the saved reading position from localStorage so a
  // refresh (or a later visit) keeps progress and the scroll spot.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setUnlocked(JSON.parse(saved));
    } catch {
      /* ignore */
    }
    try {
      const p = localStorage.getItem(posKey);
      if (p != null && p !== "") savedPosRef.current = Number(p);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [storageKey, posKey]);

  // Restore the reading position once, after hydration laid out the blocks.
  useEffect(() => {
    if (!hydrated) return;
    const idx = savedPosRef.current;
    if (idx == null || idx <= 0) return;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`sf-block-${idx}`);
      if (el) {
        el.scrollIntoView({ block: "start" });
        toast("info", "Picked up where you left off.");
      }
    });
    return () => cancelAnimationFrame(raf);
    // Run only when hydration flips true; toast is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Track the top-most visible block as the reader scrolls and persist it
  // (rAF-throttled). This is the "save point" the restore above reads back.
  useEffect(() => {
    if (!hydrated) return;
    let scheduled = 0;
    const onScroll = () => {
      if (scheduled) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        const offset = 140; // ~ below the sticky header
        let current = 0;
        for (const c of chunks) {
          const el = document.getElementById(`sf-block-${c.blockIndex}`);
          if (!el) continue;
          if (el.getBoundingClientRect().top <= offset) current = c.blockIndex;
          else break;
        }
        try {
          localStorage.setItem(posKey, String(current));
        } catch {
          /* ignore quota */
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scheduled) cancelAnimationFrame(scheduled);
    };
  }, [hydrated, chunks, posKey]);

  // Detect an existing silent-payment session for this device.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pay-session/balance", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setSessionActive(!!data.active);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

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
    for (const c of chunks) if (c.isFree || isOwner || unlocked[c.blockIndex] !== undefined) set.add(c.id);
    return set;
  }, [chunks, unlocked, isOwner]);
  const unlockedPayable = payable.filter((c) => unlockedChunkIds.has(c.id)).length;
  const nextLocked = payable.find((c) => !unlockedChunkIds.has(c.id));
  const allUnlocked = payable.length > 0 && unlockedPayable === payable.length;
  // Whole-piece (discounted) total — the ONLY price shown to the reader.
  const wholeDisplay = useMemo(() => wholePiecePrice(pricePerBlock, payable.length), [pricePerBlock, payable.length]);

  /** Fetch a fresh quote (price + recipient) for a block. */
  async function quoteBlock(blockIndex: number) {
    const res = await fetch(`/api/reader/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blockIndex }),
    });
    return res.json();
  }

  /**
   * Silently re-activate a prior pay-session (e.g. after the reader ended it
   * from the fuel chip) instead of prompting a fresh deposit. The Gateway is
   * still funded and the session key is still a delegate, so the remaining fuel
   * just continues from where it was. Returns true if a session was restored.
   */
  async function tryResume(): Promise<boolean> {
    if (!effectiveWallet) return false;
    const acct = loadSessionAccount(effectiveWallet);
    if (!acct) return false; // no local key → genuine first-time setup
    try {
      const res = await fetch("/api/pay-session/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mainWallet: effectiveWallet,
          sessionAddress: acct.address,
          source: walletKind === "embedded" ? "embedded" : "external",
        }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setSessionActive(true);
        window.dispatchEvent(new Event(PAY_SESSION_EVENT));
        return true;
      }
    } catch {
      /* fall through to the setup modal */
    }
    return false;
  }

  /**
   * Silent path: sign a burn intent with the local session key (no popup).
   * With `opts.optimistic`, the server renders this (non-final) block before
   * settlement and runs the combined check against `opts.priorToken`. Returns a
   * tagged result: `blocked` means the prior payment failed (don't render).
   */
  const doSilentPay = useCallback(
    async (
      blockIndex: number,
      quote: { requirements: { amount: string }; sessionRecipient: Address },
      opts?: { optimistic?: boolean; priorToken?: string | null; simulateFail?: boolean }
    ): Promise<{ ok: boolean; blocked?: boolean; token?: string }> => {
      if (!effectiveWallet) return { ok: false };
      const value = BigInt(quote.requirements.amount);
      const sessionPayment = await buildSessionPayment({
        mainWallet: effectiveWallet,
        recipient: quote.sessionRecipient,
        value,
      });
      const res = await fetch(`/api/reader/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          blockIndex,
          sessionPayment,
          ...(opts?.optimistic
            ? { optimistic: true, priorToken: opts.priorToken ?? undefined, simulateFail: opts.simulateFail || undefined }
            : {}),
        }),
      });
      const d = await res.json();
      // Combined check failed (the prior block's payment didn't go through).
      if (d.blocked) return { ok: false, blocked: true };
      if (d.paid && (d.text != null || d.alreadyUnlocked)) {
        persist({ ...unlocked, [blockIndex]: d.text ?? unlocked[blockIndex] ?? "" });
        window.dispatchEvent(new Event(PAY_SESSION_EVENT));
        toast("success", "Unlocked.");
        return { ok: true, token: typeof d.token === "string" ? d.token : undefined };
      }
      // Session ended or cap reached → fall back to setup / wallet.
      if (res.status === 401 || d.error === "no_pay_session") {
        setSessionActive(false);
        return { ok: false };
      }
      throw new Error(d.friendly ?? d.error ?? "Silent payment failed.");
    },
    [effectiveWallet, slug, unlocked, toast]
  );

  /** Wallet path (one popup): Gateway-balance sign, else a direct USDC transfer. */
  async function doWalletPay(
    blockIndex: number,
    quote: {
      requirements: {
        amount: string;
        payTo: `0x${string}`;
        asset: `0x${string}`;
        maxTimeoutSeconds: number;
        extra: { verifyingContract: `0x${string}` };
      };
    }
  ) {
    if (!address) return;
    if (chainId !== ARC_CHAIN_ID) {
      toast("info", "Approve the switch to Arc Testnet in your wallet…");
      await switchChainAsync({ chainId: ARC_CHAIN_ID });
    }
    const req = quote.requirements;
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
      toast("info", "Confirm to unlock. No gas fees.");
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
      toast("info", "Confirm the payment in your wallet…");
      const hash = await writeContract(wagmiConfig, {
        address: req.asset,
        abi: erc20Abi,
        functionName: "transfer",
        args: [req.payTo, amountWei],
      });
      toast("info", "Payment sent. Confirming on Arc…");
      await waitForTransactionReceipt(wagmiConfig, { hash });
      d = await (await fetch(`/api/reader/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blockIndex, directTx: { hash, from: address } }),
      })).json();
    }

    if (d.paid && d.text != null) {
      persist({ ...unlocked, [blockIndex]: d.text });
      toast("success", "Unlocked.");
    } else {
      throw new Error(d.friendly ?? d.error ?? "Payment could not be settled.");
    }
  }

  async function unlock(blockIndex: number, opts?: { forceWallet?: boolean; sessionReady?: boolean }) {
    if (!hasWallet) {
      toast("warning", "Connect a wallet (or create your free one) to unlock this block.");
      return;
    }
    // The wallet fallback (pay just this block) requires an external wagmi wallet.
    const forceWallet = opts?.forceWallet && walletKind === "external";
    // `sessionReady` lets the just-completed setup signal an active session
    // without waiting for the async `sessionActive` state to flush — otherwise
    // this call reads the stale `false` and re-opens the setup modal.
    let hasSession = sessionActive || !!opts?.sessionReady;
    setPaying(blockIndex);
    setError(null);
    try {
      const quote = await quoteBlock(blockIndex);
      if (quote.free) {
        persist({ ...unlocked, [blockIndex]: quote.text });
        return;
      }
      if (!quote.needsPayment) throw new Error(quote.friendly ?? quote.error ?? "Could not price this block.");

      // No active session, but the reader may have one to resume (they ended it
      // earlier while the Gateway still holds funds). Restore it silently rather
      // than asking them to deposit again.
      if (!hasSession && !forceWallet && (await tryResume())) hasSession = true;

      // Preferred: silent session payment (no popup) when a session is active.
      if (hasSession && !forceWallet) {
        // Optimistic path (flag on, non-final block): render now, settle in the
        // background, and run the combined check against the prior block's token.
        // The server marks the final chunk `optimistic:false` so it confirms first.
        const optimistic = quote.optimistic === true;
        const simulateFail =
          optimistic && new URLSearchParams(window.location.search).get("simfail") === String(blockIndex);
        const r = await doSilentPay(
          blockIndex,
          quote,
          optimistic ? { optimistic: true, priorToken: lastTokenRef.current, simulateFail } : undefined
        );
        if (r.blocked) {
          // Combined check failed — the prior payment didn't go through. Don't
          // render this block; surface a resolve state (already-shown stays).
          setBlocked(true);
          setError("Your previous payment didn't go through. Retry, or add funds to continue.");
          return;
        }
        if (r.ok) {
          if (optimistic) {
            lastTokenRef.current = r.token ?? lastTokenRef.current;
            lastBlockRef.current = blockIndex;
          }
          setBlocked(false);
          setError(null);
          return;
        }
        // session unusable → offer setup again.
        setPendingBlock(blockIndex);
        setShowSetup(true);
        return;
      }

      // No session yet → invite the one-time setup (unless paying by wallet).
      if (!forceWallet) {
        setPendingBlock(blockIndex);
        setShowSetup(true);
        return;
      }

      await doWalletPay(blockIndex, quote);
    } catch (e) {
      const msg = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
      if (/rejected|denied|cancell?ed/i.test(msg)) {
        toast("info", "Payment cancelled. Nothing was charged.");
      } else {
        setError(msg);
        toast("error", msg, "Payment failed");
      }
    } finally {
      setPaying(null);
    }
  }

  /**
   * Resolve a blocked combined check: re-pay the prior block whose payment
   * failed (a fresh optimistic payment, no combined gate), then continue to the
   * block the reader was trying to reach.
   */
  async function retryUnlock(currentBlock: number) {
    setBlocked(false);
    setError(null);
    const prior = lastBlockRef.current;
    if (prior != null) {
      setPaying(prior);
      try {
        const q = await quoteBlock(prior);
        if (q.needsPayment) {
          const r = await doSilentPay(prior, q, { optimistic: true, priorToken: null });
          if (!r.ok) {
            setBlocked(true);
            setError("Still couldn't settle that payment. Add funds to continue.");
            return;
          }
          lastTokenRef.current = r.token ?? null;
          lastBlockRef.current = prior;
        }
      } catch (e) {
        setBlocked(true);
        setError(String((e as Error)?.message ?? e));
        return;
      } finally {
        setPaying(null);
      }
    }
    await unlock(currentBlock);
  }

  /**
   * Whole-piece purchase: one silent session-key payment for the discounted lot,
   * unlocking every payable block at once. Always routes through the session
   * (opening setup first if needed) — the price the reader sees is the only one.
   */
  async function doWholeSilent(): Promise<boolean> {
    if (!effectiveWallet) return false;
    const quote = await quoteWhole();
    if (!quote.needsPayment) throw new Error(quote.friendly ?? quote.error ?? "Couldn't price this piece.");
    const sessionPayment = await buildSessionPayment({
      mainWallet: effectiveWallet,
      recipient: quote.sessionRecipient,
      value: BigInt(quote.requirements.amount),
    });
    const res = await fetch(`/api/reader/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ whole: true, sessionPayment }),
    });
    const d = await res.json();
    if (d.paid && d.texts) {
      const merged: Record<number, string> = { ...unlocked };
      for (const [k, v] of Object.entries(d.texts as Record<string, string>)) merged[Number(k)] = v;
      persist(merged);
      window.dispatchEvent(new Event(PAY_SESSION_EVENT));
      toast("success", "Unlocked the whole piece. Enjoy.");
      return true;
    }
    if (res.status === 401 || d.error === "no_pay_session") {
      setSessionActive(false);
      return false;
    }
    throw new Error(d.friendly ?? d.error ?? "Couldn't unlock the whole piece.");
  }

  async function quoteWhole() {
    const res = await fetch(`/api/reader/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ whole: true }),
    });
    return res.json();
  }

  async function unlockWhole(opts?: { sessionReady?: boolean }) {
    if (!hasWallet) {
      toast("warning", "Connect a wallet (or create your free one) to unlock this.");
      return;
    }
    let hasSession = sessionActive || !!opts?.sessionReady;
    setPaying(-1); // sentinel: whole-piece in flight (disables the per-block buttons)
    setError(null);
    try {
      if (!hasSession && (await tryResume())) hasSession = true;
      if (!hasSession) {
        setPendingWhole(true);
        setShowSetup(true);
        return;
      }
      const ok = await doWholeSilent();
      if (!ok) {
        setPendingWhole(true);
        setShowSetup(true);
      }
    } catch (e) {
      const msg = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
      if (/rejected|denied|cancell?ed/i.test(msg)) toast("info", "Payment cancelled. Nothing was charged.");
      else {
        setError(msg);
        toast("error", msg, "Couldn't unlock the whole piece");
      }
    } finally {
      setPaying(null);
    }
  }

  function onSessionReady(_session: PaySessionInfo) {
    setSessionActive(true);
    setShowSetup(false); // close the setup box immediately — payment is set up
    window.dispatchEvent(new Event(PAY_SESSION_EVENT));
    // Pass sessionReady so the follow-up takes the silent path now, instead of
    // reading the not-yet-flushed `sessionActive` and re-opening the modal.
    if (pendingWhole) {
      setPendingWhole(false);
      void unlockWhole({ sessionReady: true });
      setPendingBlock(null);
      return;
    }
    const blk = pendingBlock;
    setPendingBlock(null);
    if (blk != null) void unlock(blk, { sessionReady: true });
  }

  /** Create the free embedded wallet, then continue to unlock the pending block. */
  async function createWalletThenUnlock(blockIndex: number) {
    setPaying(blockIndex);
    try {
      await embedded.provision();
      toast("success", "Wallet created. You can pay per block now.");
      // status refresh is async; the user can tap Unlock once it lands.
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e);
      if (/rejected|denied|cancell?ed/i.test(msg)) toast("info", "Wallet setup cancelled.");
      else toast("error", msg, "Couldn't create wallet");
    } finally {
      setPaying(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-margin-mobile py-stack-lg md:px-margin-desktop">
      <div className="mb-6 flex items-center justify-between gap-2">
        <Link href="/for-you" className="inline-flex h-11 items-center gap-1 font-label-caps text-label-caps text-outline hover:text-primary">
          ← For You
        </Link>
        {/* Compact toolbar: the Reading-Fuel pill grouped with icon-only actions. */}
        <div className="flex items-center gap-1">
          {/* Reading fuel now lives inline beside the progress indicator below as a
              compact %, keeping the header uncluttered (esp. on mobile). */}
          <ShareButton slug={slug} title={title} iconOnly />
          <ReportButton contentSlug={slug} iconOnly />
        </div>
      </div>

      <div className="mb-1 flex items-center gap-2">
        <span className="pill">{props.contentType}</span>
        {props.verifiedSource && (
          <span
            className="flex items-center gap-0.5 font-label-caps text-label-caps text-secondary"
            title={`Ownership of the original ${props.verifiedSource} verified`}
          >
            <span className="material-symbols-outlined text-[15px]">verified</span>verified source
          </span>
        )}
        {agentUrl && (
          <a href={agentUrl} className="font-data-mono text-[11px] text-primary" title="Agent endpoint">agent-skills.md</a>
        )}
        {agentUrl && <ShareAgentButton slug={slug} title={title} pricePerBlock={pricePerBlock} variant="detail" />}
      </div>
      <h1 className="font-display-lg text-display-lg-mobile">{title}</h1>
      <p className="mb-2 font-body-md text-on-surface-variant">by @{creatorHandle ?? "unknown"}</p>

      {/* Progress — the reading-fuel % sits inline here (tap to expand the pill). */}
      <div className="mb-6 flex items-center gap-2 font-body-sm text-on-surface-variant">
        <span>{unlockedPayable} of {payable.length} {isPicture ? "images" : "blocks"} unlocked</span>
        {sessionActive && <span className="text-secondary">· one-tap on</span>}
        {hasWallet && !isOwner && (
          <span className="flex items-center gap-1">
            <span aria-hidden>·</span>
            <ReadingFuel variant="inline" pricePerBlock={pricePerBlock} onTopUp={() => setShowSetup(true)} />
          </span>
        )}
      </div>

      {summary && <p className="mb-6 border-l-4 border-outline-variant pl-4 font-body-lg text-on-surface-variant">{summary}</p>}

      {/* Owner view: this is your work — read it free, jump to the editor. */}
      {isOwner && (
        <div className="mb-8 flex items-center justify-between gap-3 rounded-xl border border-secondary/30 bg-secondary/5 px-4 py-3 font-body-sm text-secondary">
          <span className="inline-flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">edit_note</span>
            This is your piece, so every block is unlocked for you.
          </span>
          <Link href="/dashboard" className="font-label-caps text-label-caps text-primary hover:underline">
            Edit in dashboard →
          </Link>
        </div>
      )}

      {/* Whole-piece upsell — the single place a price is shown. Skip the bulk
          discount math for a one-block piece (nothing to discount). Owners read
          free, so never show them the upsell. */}
      {!isOwner && !allUnlocked && payable.length > 1 && hasWallet && (
        <button
          onClick={() => unlockWhole()}
          disabled={paying !== null}
          className="mb-8 flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-5 py-3 font-body-md text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[18px]">auto_stories</span>
          {paying === -1
            ? "Unlocking the whole piece…"
            : `Unlock the whole ${isPicture ? "set" : "piece"} for ${formatUsdc(wholeDisplay)} USDC`}
        </button>
      )}

      <div className="flex flex-col gap-4">
        {chunks.map((c) => {
          const text = c.isFree || isOwner ? c.text : unlocked[c.blockIndex];
          const isUnlocked = text !== undefined && text !== null;
          let inner: ReactNode;
          if (isUnlocked) {
            // Picture Skim-Flow: the unlocked `text` is the image URL.
            inner = isPicture ? (
              <SkimImage src={text} caption={c.caption} slug={slug} blockIndex={c.blockIndex} />
            ) : (
              <article>
                <RichText source={text} />
              </article>
            );
          } else {
            const isNext = nextLocked?.id === c.id;
            inner = (
              <div className="relative py-2">
              {/* Borderless blurred continuation — same column as the article,
                  fading into the page background (no card, no hard edges). */}
              <div
                className="pointer-events-none select-none space-y-3 font-reading text-reading leading-relaxed text-on-surface-variant blur-[6px] [mask-image:linear-gradient(to_bottom,rgba(0,0,0,0.85),transparent)]"
                aria-hidden
              >
                <p>{"████████ ██████ ████ ███████ █████ ████████ ██████ ████ ██████ ████."}</p>
                <p>{"███ █████ ████████ ██████ ███ █████ ████ ██████ ███████ ████ ███ ██."}</p>
                <p>{"██████ ████ ███████ █████ ████████ ██████ ████ ██████ ███ ████."}</p>
              </div>

              {isNext && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
                  {blocked ? (
                    <div className="flex flex-col items-center gap-2 rounded-2xl border border-outline-variant bg-surface/70 px-5 py-4 backdrop-blur">
                      <p className="font-body-sm text-[13px] text-error">
                        Your previous payment didn&apos;t go through. Resolve it to keep reading.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => void retryUnlock(c.blockIndex)}
                          disabled={paying !== null}
                          className="rounded-full bg-primary px-6 py-2.5 font-label-caps text-label-caps text-on-primary transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                        >
                          {paying !== null ? "Retrying…" : "Retry"}
                        </button>
                        <button
                          onClick={() => { setBlocked(false); setShowSetup(true); }}
                          disabled={paying !== null}
                          className="rounded-full border border-outline-variant px-6 py-2.5 font-label-caps text-label-caps text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-50"
                        >
                          Add funds
                        </button>
                      </div>
                    </div>
                  ) : walletLoading ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-surface/70 px-4 py-2 font-body-sm text-[13px] text-on-surface-variant backdrop-blur">
                      <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                      Checking your wallet…
                    </span>
                  ) : !hasWallet ? (
                    <div className="flex flex-col items-center gap-2 rounded-2xl border border-outline-variant bg-surface/70 px-5 py-4 backdrop-blur">
                      {canCreateEmbedded && (
                        <button
                          onClick={() => createWalletThenUnlock(c.blockIndex)}
                          disabled={paying !== null || embedded.busy}
                          className="rounded-full bg-primary px-8 py-3 font-label-caps text-label-caps text-on-primary transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                        >
                          {paying === c.blockIndex || embedded.busy ? "Creating wallet…" : "Create your free wallet"}
                        </button>
                      )}
                      <ConnectButton />
                      {canCreateEmbedded && (
                        <span className="font-body-sm text-[11px] text-outline">
                          Free wallet (no app), or connect your own.
                        </span>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Muted lock caption — low-contrast, never competing with the CTA. */}
                      <span className="inline-flex items-center gap-1 font-label-caps text-[10px] uppercase tracking-wide text-outline/70">
                        <span className="material-symbols-outlined text-[13px]">lock</span>
                        Block {c.blockIndex} locked
                      </span>
                      {/* Platform-wide rule: the unlock CTA always reads "Read on" —
                          never the price. A pill floating dead-center over the blur,
                          lifted off the page with a subtle shadow + backdrop-blur. */}
                      <button
                        onClick={() => unlock(c.blockIndex)}
                        disabled={paying !== null}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-primary px-8 py-3 font-label-caps text-label-caps text-on-primary shadow-lg shadow-primary/20 ring-1 ring-black/5 backdrop-blur transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                      >
                        {paying === c.blockIndex
                          ? sessionActive ? "Unlocking…" : walletKind === "embedded" ? "Setting up…" : "Confirm in wallet…"
                          : "Read on"}
                      </button>
                      {!sessionActive && walletKind === "external" && (
                        <button
                          onClick={() => unlock(c.blockIndex, { forceWallet: true })}
                          disabled={paying !== null}
                          className="font-body-sm text-[12px] text-outline hover:text-primary"
                        >
                          or pay just this block with your wallet
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            );
          }
          // Stable per-block anchor for the reading-progress save point.
          return (
            <div key={c.id} id={`sf-block-${c.blockIndex}`} data-block={c.blockIndex} className="scroll-mt-20">
              {inner}
            </div>
          );
        })}
      </div>

      {error && <p className="mt-4 font-body-sm text-[13px] text-primary">{error}</p>}

      {!isOwner && payable.length > 0 && unlockedPayable === payable.length && (
        <div className="mt-8 flex items-center justify-center gap-2 rounded-xl border border-secondary/30 bg-secondary/5 p-6 text-center font-body-md text-secondary">
          <span className="material-symbols-outlined text-[20px]">check_circle</span>
          Fully unlocked. Every block paid the creator directly.
        </div>
      )}

      {showSetup && effectiveWallet && walletKind && (
        <PaySetupModal
          mainWallet={effectiveWallet}
          kind={walletKind}
          suggestedCap={Math.max(Number(pricePerBlock) * payable.length, Number(pricePerBlock) * 5)}
          isTopUp={sessionActive}
          onReady={onSessionReady}
          onClose={() => {
            setShowSetup(false);
            setPendingBlock(null);
            setPendingWhole(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * A single Skim-Flow image. The <img> load runs in parallel with payment (no
 * blocking pre-check). If the link is dead the reader isn't blocked from
 * advancing; for an image they've already paid for, we offer "Report this
 * issue" which files a broken_link report into the admin inbox (§5b).
 */
function SkimImage({
  src,
  caption,
  slug,
  blockIndex,
}: {
  src: string;
  caption?: string | null;
  slug: string;
  blockIndex: number;
}) {
  const [broken, setBroken] = useState(false);
  const [reported, setReported] = useState(false);

  async function report() {
    try {
      await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportType: "broken_link", reason: "broken_link", contentSlug: slug, blockIndex }),
      });
    } finally {
      setReported(true);
    }
  }

  if (broken) {
    return (
      <figure className="flex flex-col items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-low/60 p-8 text-center">
        <span className="material-symbols-outlined text-[28px] text-outline">broken_image</span>
        <span className="font-body-sm text-[13px] text-on-surface-variant">This image is no longer available.</span>
        {reported ? (
          <span className="font-body-sm text-[12px] text-secondary">Reported. Thanks, our team will review it.</span>
        ) : (
          <button onClick={report} className="font-body-sm text-[12px] text-primary hover:underline">
            Report this issue
          </button>
        )}
        {caption && <figcaption className="font-body-sm text-[12px] text-outline">{caption}</figcaption>}
      </figure>
    );
  }

  return (
    <figure className="overflow-hidden rounded-xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={caption ?? ""} onError={() => setBroken(true)} className="w-full rounded-xl object-contain" />
      {caption && <figcaption className="mt-2 font-body-sm text-[13px] text-on-surface-variant">{caption}</figcaption>}
    </figure>
  );
}
