"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useToast } from "@/components/Toaster";
import { clearSessionKey } from "@/lib/session-key-client";

interface BalanceState {
  active: boolean;
  cap?: string;
  spent?: string;
  remaining?: string;
}

/** Fired by the reader after each silent payment so the chip updates at once. */
export const PAY_SESSION_EVENT = "skimflow:paysession";

interface Props {
  /** Per-block price — used to warn when fewer than ~2 blocks remain. */
  pricePerBlock?: string;
  /** Open the setup modal to (re)authorize / raise the cap. */
  onTopUp?: () => void;
}

/**
 * Compact nav chip showing the remaining silent-spend allowance. Polls the
 * balance endpoint, refreshes immediately on a payment event, warns once when
 * the allowance runs low, and offers revoke.
 */
export default function BalanceChip({ pricePerBlock, onTopUp }: Props) {
  const [state, setState] = useState<BalanceState>({ active: false });
  const { address } = useAccount();
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
          toast("warning", "Silent-pay balance is running low — top up to keep reading without popups.");
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

  async function revoke() {
    try {
      await fetch("/api/pay-session/revoke", { method: "POST" });
      if (address) clearSessionKey(address);
      setState({ active: false });
      toast("info", "Silent payments ended.");
      window.dispatchEvent(new Event(PAY_SESSION_EVENT));
    } catch {
      toast("error", "Couldn't end the session.");
    }
  }

  if (!state.active) return null;

  // Always display 2 decimals to users; full precision stays in the backend.
  const fmt = (v?: string) => (v != null ? Number(v).toFixed(2) : "0.00");
  const remaining = Number(state.remaining ?? "0");
  const nextBlock = pricePerBlock ? Number(pricePerBlock) : 0;
  // Can't cover the next unlock — prompt a top-up (low-but-nonzero / depleted).
  const insufficient = nextBlock > 0 && remaining < nextBlock;

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-data-mono text-[12px] ${
        insufficient ? "border-primary/40 bg-primary/5 text-primary" : "border-secondary/30 bg-secondary/5 text-secondary"
      }`}
    >
      <span className="material-symbols-outlined text-[15px]">bolt</span>
      <span title={`Cap ${fmt(state.cap)} · spent ${fmt(state.spent)}`}>${fmt(state.remaining)} left</span>
      {insufficient && onTopUp ? (
        <button onClick={onTopUp} className="font-label-caps text-primary hover:underline">
          {remaining <= 0 ? "Add funds to read" : "Top up to continue"}
        </button>
      ) : (
        onTopUp && (
          <button onClick={onTopUp} className="text-primary hover:underline" title="Raise your cap">
            top up
          </button>
        )
      )}
      <button onClick={revoke} className="text-outline hover:text-on-surface" title="End silent payments">
        ✕
      </button>
    </div>
  );
}
