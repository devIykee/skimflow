"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toaster";

interface BalanceState {
  active: boolean;
  cap?: string;
  spent?: string;
  remaining?: string;
}

/** Fired by the reader after each silent payment so the gauge updates at once. */
export const PAY_SESSION_EVENT = "skimflow:paysession";

interface Props {
  /** Per-block price — used to warn when fewer than ~2 blocks remain. */
  pricePerBlock?: string;
  /** Open the setup modal to add funds / raise the cap. */
  onTopUp?: () => void;
  /**
   * "pill" (default) renders the full battery pill inline. "inline" renders just
   * a compact `N%` number that sits beside a page/progress indicator; tapping it
   * pops the full pill as a floating overlay (dismiss on outside tap / timeout).
   */
  variant?: "pill" | "inline";
}

/**
 * "Reading Fuel" gauge — the consumer-friendly face of the silent-spend
 * allowance. Shows a battery bar + percentage instead of a raw USDC balance.
 * Polls the balance endpoint, refreshes on a payment event, warns once when fuel
 * runs low, and offers to add funds / end the session.
 *
 * Two presentations from one source of truth so every reader behaves the same:
 *   • pill   — the full battery pill (used where there's room).
 *   • inline — a compact `N%` beside the page number; tap to reveal the pill in a
 *              floating popover. Keeps the mobile reader header uncluttered.
 */
export default function ReadingFuel({ pricePerBlock, onTopUp, variant = "pill" }: Props) {
  const [state, setState] = useState<BalanceState>({ active: false });
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();
  const warnedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/pay-session/balance", { cache: "no-store" });
      const data = (await res.json()) as BalanceState;
      setState(data);
      if (data.active && data.remaining != null) {
        const remaining = Number(data.remaining);
        const lowAt = pricePerBlock ? Number(pricePerBlock) * 2 : 0.01;
        if (remaining <= lowAt && !warnedRef.current) {
          warnedRef.current = true;
          toast("warning", "Your reading fuel is running low. Add funds to keep flowing without interruptions.");
        }
        if (remaining > lowAt) warnedRef.current = false;
      }
    } catch {
      /* transient — keep last state */
    }
  }, [pricePerBlock, toast]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 8000);
    const onEvt = () => refresh();
    window.addEventListener(PAY_SESSION_EVENT, onEvt);
    return () => {
      clearInterval(iv);
      window.removeEventListener(PAY_SESSION_EVENT, onEvt);
    };
  }, [refresh]);

  // Auto-dismiss the floating pill a few seconds after it opens.
  useEffect(() => {
    if (!expanded) return;
    const t = setTimeout(() => setExpanded(false), 4000);
    return () => clearTimeout(t);
  }, [expanded]);

  async function revoke() {
    try {
      await fetch("/api/pay-session/revoke", { method: "POST" });
      // Keep the local session key (and the on-chain delegate it represents) so
      // the reader can silently resume against the still-funded Gateway balance
      // on the next "Read on" — without depositing again.
      setState({ active: false });
      setExpanded(false);
      toast("info", "Reading session ended. Your balance stays put if you read on again.");
      window.dispatchEvent(new Event(PAY_SESSION_EVENT));
    } catch {
      toast("error", "Couldn't end the session.");
    }
  }

  if (!state.active) return null;

  // 2-decimal display only; full precision stays in the backend.
  const fmt = (v?: string) => (v != null ? Number(v).toFixed(2) : "0.00");
  const cap = Number(state.cap ?? "0");
  const remaining = Number(state.remaining ?? "0");
  const pct = cap > 0 ? Math.max(0, Math.min(100, Math.round((remaining / cap) * 100))) : 0;
  const nextBlock = pricePerBlock ? Number(pricePerBlock) : 0;
  // Can't cover the next unlock — prompt adding funds (low-but-nonzero / depleted).
  const insufficient = nextBlock > 0 && remaining < nextBlock;
  const tone = insufficient
    ? "border-primary/40 bg-primary/5 text-primary"
    : "border-secondary/30 bg-secondary/5 text-secondary";

  // ── The full battery pill (shared by both variants) ───────────────────────
  const pill = (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-data-mono text-[12px] ${tone}`}>
      {/* Battery gauge — click to reveal the exact USDC behind the percentage. */}
      <button
        onClick={() => setRevealed((r) => !r)}
        className="inline-flex items-center gap-1.5"
        title={revealed ? "Hide amount" : "Show exact balance"}
      >
        <span className="material-symbols-outlined text-[15px]">bolt</span>
        <span className="relative h-2 w-9 overflow-hidden rounded-full bg-current/15" aria-hidden>
          <span className="absolute inset-y-0 left-0 rounded-full bg-current" style={{ width: `${pct}%` }} />
        </span>
        <span>{revealed ? `$${fmt(state.remaining)} of $${fmt(state.cap)}` : `${pct}% fuel`}</span>
      </button>
      {insufficient && onTopUp ? (
        <button onClick={onTopUp} className="font-label-caps text-primary hover:underline">
          Add funds
        </button>
      ) : (
        onTopUp && (
          <button onClick={onTopUp} className="text-primary hover:underline" title="Add funds / raise your cap">
            add funds
          </button>
        )
      )}
      <button onClick={revoke} className="text-outline hover:text-on-surface" title="End reading session">
        ✕
      </button>
    </div>
  );

  if (variant === "pill") return pill;

  // ── Inline variant: a compact `N%` that pops the pill on tap ──────────────
  return (
    <span className="relative inline-flex items-center">
      <button
        onClick={() => setExpanded((e) => !e)}
        className={`inline-flex items-center gap-0.5 font-data-mono text-[12px] ${insufficient ? "text-primary" : "text-secondary"}`}
        title="Reading fuel — tap for details"
        aria-expanded={expanded}
      >
        <span className="material-symbols-outlined text-[13px]">bolt</span>
        {pct}%
      </button>
      {expanded && (
        <>
          {/* Tap-outside catcher. */}
          <span className="fixed inset-0 z-[60]" onClick={() => setExpanded(false)} aria-hidden />
          {/* Floating pill, anchored to the number. */}
          <span className="absolute right-0 top-full z-[61] mt-2 whitespace-nowrap">{pill}</span>
        </>
      )}
    </span>
  );
}
