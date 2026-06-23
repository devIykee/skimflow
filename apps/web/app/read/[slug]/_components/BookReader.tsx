"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { useToast } from "@/components/Toaster";
import { formatUsdc, wholePiecePrice } from "@/lib/money";
import { buildSessionPayment, loadSessionAccount } from "@/lib/session-key-client";
import { useEmbeddedWallet } from "@/lib/useEmbeddedWallet";
import PaySetupModal, { type PaySessionInfo } from "@/components/PaySetupModal";
import ReadingFuel, { PAY_SESSION_EVENT } from "@/components/ReadingFuel";
import RichText from "@/components/RichText";

interface ChapterMeta {
  id: string;
  index: number;
  title: string;
}
interface PageView {
  id: string;
  blockIndex: number;
  isFree: boolean;
  chapterId: string | null;
  text: string | null;
}
interface Props {
  slug: string;
  title: string;
  creatorHandle: string | null;
  pricePerBlock: string;
  chapters: ChapterMeta[];
  pages: PageView[];
  /** Viewer owns this book (creator/admin): every page free, no paywall. */
  isOwner?: boolean;
}

const SWIPE_THRESHOLD = 50;

/**
 * Moon+-style immersive book reader. Full-screen overlay (covers the global nav),
 * horizontal pagination — one DB page (chunk) per screen — navigated by tapping
 * the screen edges, swiping, or the arrow keys. A tap in the centre toggles the
 * chrome (top bar + bottom progress). Advancing into a not-yet-paid page fires a
 * silent session-key payment invisibly; the first page is always free.
 */
export default function BookReader({ slug, title, creatorHandle, pricePerBlock, chapters, pages, isOwner = false }: Props) {
  const storageKey = `skimflow_reader_${slug}`;
  const posKey = `skimflow_reader_pos_${slug}`;
  const bookmarksKey = `skimflow_reader_bookmarks_${slug}`;
  const [unlocked, setUnlocked] = useState<Record<number, string>>({});
  const [current, setCurrent] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [chapterListOpen, setChapterListOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<number[]>([]); // bookmarked blockIndexes
  const [paying, setPaying] = useState<number | null>(null);
  const hydratedRef = useRef(false);

  const [sessionActive, setSessionActive] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [pendingBlock, setPendingBlock] = useState<number | null>(null);
  const [pendingWhole, setPendingWhole] = useState(false);

  const { address } = useAccount();
  const toast = useToast();
  const embedded = useEmbeddedWallet();
  const embeddedAddr = embedded.status?.hasWallet ? (embedded.status.address as Address | null) : null;
  const effectiveWallet = (address ?? embeddedAddr ?? undefined) as Address | undefined;
  const walletKind: "external" | "embedded" | null = address ? "external" : embeddedAddr ? "embedded" : null;
  const hasWallet = !!effectiveWallet;
  const canCreateEmbedded = embedded.status?.enabled === true && embedded.status?.isAdmin === false;

  const touchStartX = useRef<number | null>(null);

  // Hydrate unlocked pages, bookmarks, and the saved reading position.
  useEffect(() => {
    let savedUnlocked: Record<number, string> = {};
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) savedUnlocked = JSON.parse(saved);
    } catch {
      /* ignore */
    }
    setUnlocked(savedUnlocked);
    try {
      const bm = localStorage.getItem(bookmarksKey);
      if (bm) setBookmarks(JSON.parse(bm));
    } catch {
      /* ignore */
    }
    try {
      const p = localStorage.getItem(posKey);
      if (p != null && p !== "") {
        const idx = Number(p);
        // Only resume onto a reachable page (free or already paid), so resuming
        // never lands on a locked page and silently triggers a payment.
        if (Number.isFinite(idx) && idx > 0 && idx < pages.length) {
          const pg = pages[idx];
          if (pg.isFree || savedUnlocked[pg.blockIndex] !== undefined) {
            setCurrent(idx);
            toast("info", "Resumed where you left off.");
          }
        }
      }
    } catch {
      /* ignore */
    }
    hydratedRef.current = true;
    // Keys are derived from the (stable) slug; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the reading position as the reader turns pages.
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(posKey, String(current));
    } catch {
      /* ignore quota */
    }
  }, [current, posKey]);

  function toggleBookmark() {
    const p = pages[current];
    if (!p) return;
    setBookmarks((bm) => {
      const has = bm.includes(p.blockIndex);
      const next = has ? bm.filter((b) => b !== p.blockIndex) : [...bm, p.blockIndex].sort((a, b) => a - b);
      try {
        localStorage.setItem(bookmarksKey, JSON.stringify(next));
      } catch {
        /* ignore quota */
      }
      toast("info", has ? "Bookmark removed." : "Bookmarked this page.");
      return next;
    });
  }

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

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

  const payable = pages.filter((p) => !p.isFree);
  const unlockedPayable = payable.filter((p) => unlocked[p.blockIndex] !== undefined).length;
  const allUnlocked = payable.length > 0 && unlockedPayable === payable.length;
  const wholeDisplay = useMemo(() => wholePiecePrice(pricePerBlock, payable.length), [pricePerBlock, payable.length]);

  const chapterById = useMemo(() => {
    const m = new Map<string, ChapterMeta>();
    for (const ch of chapters) m.set(ch.id, ch);
    return m;
  }, [chapters]);

  const isPageUnlocked = useCallback(
    (p: PageView) => isOwner || p.isFree || unlocked[p.blockIndex] !== undefined,
    [unlocked, isOwner]
  );

  function pageText(p: PageView): string | null {
    return p.isFree || isOwner ? p.text : unlocked[p.blockIndex] ?? null;
  }

  async function quoteBlock(blockIndex: number) {
    const res = await fetch(`/api/reader/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blockIndex }),
    });
    return res.json();
  }

  /**
   * Silently re-activate a prior pay-session (ended from the fuel chip) instead
   * of prompting a fresh deposit — the Gateway is still funded and the key is
   * still a delegate. Returns true if a session was restored.
   */
  async function tryResume(): Promise<boolean> {
    if (!effectiveWallet) return false;
    const acct = loadSessionAccount(effectiveWallet);
    if (!acct) return false;
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

  /** Pay for a single page silently, then turn to it. */
  async function payPage(blockIndex: number, opts?: { sessionReady?: boolean }) {
    if (!hasWallet) {
      toast("warning", "Create your free wallet (or connect one) to keep reading.");
      return;
    }
    let hasSession = sessionActive || !!opts?.sessionReady;
    if (!hasSession && (await tryResume())) hasSession = true;
    if (!hasSession) {
      setPendingBlock(blockIndex);
      setShowSetup(true);
      return;
    }
    setPaying(blockIndex);
    try {
      const quote = await quoteBlock(blockIndex);
      if (quote.free) {
        persist({ ...unlocked, [blockIndex]: quote.text });
        turnTo(blockIndex);
        return;
      }
      if (!quote.needsPayment) throw new Error(quote.friendly ?? quote.error ?? "Couldn't price this page.");
      if (!effectiveWallet) return;
      const sessionPayment = await buildSessionPayment({
        mainWallet: effectiveWallet,
        recipient: quote.sessionRecipient,
        value: BigInt(quote.requirements.amount),
      });
      const res = await fetch(`/api/reader/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blockIndex, sessionPayment }),
      });
      const d = await res.json();
      if (d.paid && (d.text != null || d.alreadyUnlocked)) {
        persist({ ...unlocked, [blockIndex]: d.text ?? unlocked[blockIndex] ?? "" });
        window.dispatchEvent(new Event(PAY_SESSION_EVENT));
        turnTo(blockIndex);
        return;
      }
      if (res.status === 401 || d.error === "no_pay_session") {
        setSessionActive(false);
        setPendingBlock(blockIndex);
        setShowSetup(true);
        return;
      }
      throw new Error(d.friendly ?? d.error ?? "Payment failed.");
    } catch (e) {
      const msg = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
      if (/rejected|denied|cancell?ed/i.test(msg)) toast("info", "Payment cancelled. Nothing was charged.");
      else toast("error", msg, "Payment failed");
    } finally {
      setPaying(null);
    }
  }

  function turnTo(blockIndex: number) {
    const idx = pages.findIndex((p) => p.blockIndex === blockIndex);
    if (idx >= 0) setCurrent(idx);
  }

  const goPrev = useCallback(() => {
    setChapterListOpen(false);
    setCurrent((c) => Math.max(0, c - 1));
  }, []);

  const goNext = useCallback(() => {
    setChapterListOpen(false);
    const target = current + 1;
    if (target >= pages.length) return;
    const p = pages[target];
    if (isPageUnlocked(p)) {
      setCurrent(target);
    } else {
      void payPage(p.blockIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, pages, isPageUnlocked]);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev]);

  /** Whole-book purchase — unlock every page in one silent payment. */
  async function unlockWhole(opts?: { sessionReady?: boolean }) {
    if (!hasWallet) {
      toast("warning", "Create your free wallet (or connect one) to unlock the book.");
      return;
    }
    let hasSession = sessionActive || !!opts?.sessionReady;
    if (!hasSession && (await tryResume())) hasSession = true;
    if (!hasSession) {
      setPendingWhole(true);
      setShowSetup(true);
      return;
    }
    setPaying(-1);
    try {
      const quote = await (
        await fetch(`/api/reader/${slug}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ whole: true }),
        })
      ).json();
      if (!quote.needsPayment) throw new Error(quote.friendly ?? quote.error ?? "Couldn't price this book.");
      if (!effectiveWallet) return;
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
        toast("success", "Unlocked the whole book. Enjoy.");
        return;
      }
      if (res.status === 401 || d.error === "no_pay_session") {
        setSessionActive(false);
        setPendingWhole(true);
        setShowSetup(true);
        return;
      }
      throw new Error(d.friendly ?? d.error ?? "Couldn't unlock the book.");
    } catch (e) {
      const msg = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
      if (/rejected|denied|cancell?ed/i.test(msg)) toast("info", "Payment cancelled. Nothing was charged.");
      else toast("error", msg, "Couldn't unlock the book");
    } finally {
      setPaying(null);
    }
  }

  function onSessionReady(_s: PaySessionInfo) {
    setSessionActive(true);
    setShowSetup(false);
    window.dispatchEvent(new Event(PAY_SESSION_EVENT));
    if (pendingWhole) {
      setPendingWhole(false);
      setPendingBlock(null);
      void unlockWhole({ sessionReady: true });
      return;
    }
    const blk = pendingBlock;
    setPendingBlock(null);
    if (blk != null) void payPage(blk, { sessionReady: true });
  }

  async function createWallet() {
    try {
      await embedded.provision();
      toast("success", "Wallet created. You can keep reading now.");
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e);
      if (/rejected|denied|cancell?ed/i.test(msg)) toast("info", "Wallet setup cancelled.");
      else toast("error", msg, "Couldn't create wallet");
    }
  }

  // Tap zones: left 30% → prev, right 30% → next, centre → toggle chrome.
  function onZoneTap(zone: "prev" | "next" | "center") {
    if (zone === "prev") goPrev();
    else if (zone === "next") goNext();
    else setChromeVisible((v) => !v);
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.changedTouches[0]?.clientX ?? null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (dx <= -SWIPE_THRESHOLD) goNext();
    else if (dx >= SWIPE_THRESHOLD) goPrev();
  }

  const currentPage = pages[current];
  const currentChapter = currentPage?.chapterId ? chapterById.get(currentPage.chapterId) : undefined;
  const currentBookmarked = currentPage ? bookmarks.includes(currentPage.blockIndex) : false;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-surface text-on-surface">
      {/* ── Top chrome ─────────────────────────────────────────────────────── */}
      <div
        className={`absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 border-b border-outline-variant bg-surface/95 px-4 py-3 backdrop-blur transition-transform duration-200 ${
          chromeVisible ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        <Link href="/for-you" className="inline-flex items-center gap-1 font-label-caps text-label-caps text-outline hover:text-primary">
          ← For You
        </Link>
        <div className="min-w-0 flex-1 truncate text-center font-headline-sm text-[15px]">
          {title}
          {currentChapter && <span className="ml-2 font-body-sm text-[12px] text-on-surface-variant">· {currentChapter.title}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleBookmark}
            aria-label={currentBookmarked ? "Remove bookmark" : "Bookmark this page"}
            aria-pressed={currentBookmarked}
            title={currentBookmarked ? "Remove bookmark" : "Bookmark this page"}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-on-surface/5 ${
              currentBookmarked ? "text-primary" : "text-on-surface-variant"
            }`}
          >
            <span className={`material-symbols-outlined text-[20px] ${currentBookmarked ? "[font-variation-settings:'FILL'_1]" : ""}`}>
              bookmark
            </span>
          </button>
          {hasWallet && !isOwner && <ReadingFuel pricePerBlock={pricePerBlock} onTopUp={() => setShowSetup(true)} />}
        </div>
      </div>

      {/* ── Page surface ───────────────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div
          className="flex h-full transition-transform duration-200 ease-out"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {pages.map((p) => {
            const text = pageText(p);
            return (
              <div key={p.id} className="h-full w-full shrink-0 overflow-y-auto">
                <div className="mx-auto max-w-2xl px-6 py-20 md:py-24">
                  {text != null ? (
                    <RichText source={text} />
                  ) : (
                    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
                      <span className="material-symbols-outlined text-[28px] text-outline">lock</span>
                      <p className="font-body-md text-on-surface-variant">Turn the page to keep reading.</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Tap zones (under the chrome, above the pages). */}
        <div className="absolute inset-0 z-10 flex">
          <button aria-label="Previous page" className="h-full w-[30%]" onClick={() => onZoneTap("prev")} />
          <button aria-label="Toggle menu" className="h-full w-[40%]" onClick={() => onZoneTap("center")} />
          <button aria-label="Next page" className="h-full w-[30%]" onClick={() => onZoneTap("next")} />
        </div>

        {/* Paying / loading veil for page turns that require payment. */}
        {paying != null && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-4 py-2 font-body-sm text-[13px] text-on-surface shadow-md">
              <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
              {paying === -1 ? "Unlocking the book…" : "Unlocking…"}
            </span>
          </div>
        )}

        {/* No-wallet gate (shown over the surface when the next page needs paying). */}
        {!hasWallet && current + 1 < pages.length && !isPageUnlocked(pages[current + 1]) && chromeVisible && (
          <div className="absolute inset-x-0 bottom-24 z-30 mx-auto flex max-w-sm flex-col items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-high p-4 text-center shadow-lg">
            <p className="font-body-sm text-[13px] text-on-surface-variant">Create your free wallet to keep reading.</p>
            {canCreateEmbedded && (
              <button onClick={createWallet} disabled={embedded.busy} className="btn-primary px-6 py-2">
                {embedded.busy ? "Creating…" : "Create your free wallet"}
              </button>
            )}
            <ConnectButton />
          </div>
        )}
      </div>

      {/* ── Bottom chrome ──────────────────────────────────────────────────── */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 border-t border-outline-variant bg-surface/95 px-4 py-3 backdrop-blur transition-transform duration-200 ${
          chromeVisible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {!isOwner && !allUnlocked && payable.length > 0 && hasWallet && (
          <button
            onClick={() => unlockWhole()}
            disabled={paying !== null}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 font-body-sm text-primary hover:bg-primary/10 disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]">auto_stories</span>
            Unlock the whole book for {formatUsdc(wholeDisplay)} USDC
          </button>
        )}
        <div className="flex items-center justify-between gap-3 font-body-sm text-[12px] text-on-surface-variant">
          <div className="flex items-center gap-3">
            <button onClick={() => { setChapterListOpen((o) => !o); setBookmarksOpen(false); }} className="inline-flex items-center gap-1 hover:text-primary">
              <span className="material-symbols-outlined text-[16px]">list</span>
              Chapters
            </button>
            <button onClick={() => { setBookmarksOpen((o) => !o); setChapterListOpen(false); }} className="inline-flex items-center gap-1 hover:text-primary">
              <span className="material-symbols-outlined text-[16px]">bookmarks</span>
              {bookmarks.length > 0 ? bookmarks.length : ""} Bookmarks
            </button>
          </div>
          <span className="font-data-mono">
            Page {current + 1} of {pages.length}
          </span>
          <span className="hidden text-outline sm:inline">by @{creatorHandle ?? "unknown"}</span>
        </div>
        {/* Progress rail */}
        <div className="h-1 w-full overflow-hidden rounded-full bg-outline-variant/40">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pages.length > 1 ? (current / (pages.length - 1)) * 100 : 100}%` }}
          />
        </div>
      </div>

      {/* ── Chapter list drawer ────────────────────────────────────────────── */}
      {chapterListOpen && (
        <div className="absolute inset-0 z-40 flex" onClick={() => setChapterListOpen(false)}>
          <div
            className="ml-auto h-full w-72 max-w-[80vw] overflow-y-auto border-l border-outline-variant bg-surface p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 font-headline-sm text-[16px]">Chapters</h3>
            <ul className="flex flex-col gap-1">
              {chapters.map((ch) => {
                const firstPage = pages.find((p) => p.chapterId === ch.id);
                const reachable = firstPage ? isPageUnlocked(firstPage) : false;
                return (
                  <li key={ch.id}>
                    <button
                      onClick={() => {
                        setChapterListOpen(false);
                        if (!firstPage) return;
                        if (reachable) turnTo(firstPage.blockIndex);
                        else void payPage(firstPage.blockIndex);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left font-body-sm text-[13px] hover:bg-surface-container-low"
                    >
                      <span className="truncate">
                        <span className="text-outline">{ch.index + 1}.</span> {ch.title || "Untitled"}
                      </span>
                      {!reachable && <span className="material-symbols-outlined text-[15px] text-outline">lock</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* ── Bookmarks drawer ───────────────────────────────────────────────── */}
      {bookmarksOpen && (
        <div className="absolute inset-0 z-40 flex" onClick={() => setBookmarksOpen(false)}>
          <div
            className="ml-auto h-full w-72 max-w-[80vw] overflow-y-auto border-l border-outline-variant bg-surface p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 font-headline-sm text-[16px]">Bookmarks</h3>
            {bookmarks.length === 0 ? (
              <p className="font-body-sm text-[13px] text-on-surface-variant">
                No bookmarks yet. Tap the bookmark icon at the top to save a page.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {bookmarks.map((bi) => {
                  const pageIdx = pages.findIndex((p) => p.blockIndex === bi);
                  if (pageIdx < 0) return null;
                  const p = pages[pageIdx];
                  const ch = p.chapterId ? chapterById.get(p.chapterId) : undefined;
                  const reachable = isPageUnlocked(p);
                  return (
                    <li key={bi} className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setBookmarksOpen(false);
                          if (reachable) turnTo(bi);
                          else void payPage(bi);
                        }}
                        className="flex flex-1 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left font-body-sm text-[13px] hover:bg-surface-container-low"
                      >
                        <span className="truncate">
                          <span className="text-outline">Page {pageIdx + 1}</span>
                          {ch && <span className="text-on-surface-variant"> · {ch.title || "Untitled"}</span>}
                        </span>
                        {!reachable && <span className="material-symbols-outlined text-[15px] text-outline">lock</span>}
                      </button>
                      <button
                        onClick={() =>
                          setBookmarks((bm) => {
                            const next = bm.filter((b) => b !== bi);
                            try {
                              localStorage.setItem(bookmarksKey, JSON.stringify(next));
                            } catch {
                              /* ignore quota */
                            }
                            return next;
                          })
                        }
                        aria-label="Remove bookmark"
                        title="Remove bookmark"
                        className="shrink-0 text-outline hover:text-error"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {showSetup && effectiveWallet && walletKind && (
        <PaySetupModal
          mainWallet={effectiveWallet}
          kind={walletKind}
          suggestedCap={Math.max(Number(wholeDisplay), Number(pricePerBlock) * 5)}
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
