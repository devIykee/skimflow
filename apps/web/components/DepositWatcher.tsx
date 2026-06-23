"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/Toaster";
import { PAY_SESSION_EVENT } from "@/components/ReadingFuel";

interface Snapshot {
  signedIn: boolean;
  address?: string | null;
  usdc?: string | null;
  gateway?: string | null;
}

const POLL_MS = 25_000;
// Per-address baseline so a deposit that arrived while away is still announced
// once on return — but only an increase ever toasts, never the first read.
const SEEN_KEY = (addr: string) => `skimflow:lastBalance:${addr.toLowerCase()}`;

/**
 * Watches the signed-in user's on-chain USDC and announces incoming deposits
 * with a toast ("You received X USDC"). Mounted once, globally. Polls a light
 * balance endpoint only while the tab is visible, compares against a per-address
 * baseline in localStorage, and refreshes the Reading Fuel gauge when the
 * spendable gateway balance grows (e.g. an external top-up settling).
 */
export default function DepositWatcher() {
  const { status } = useSession();
  const toast = useToast();
  // Last seen gateway balance this session — drives the fuel-gauge refresh only.
  const lastGatewayRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;

    const round2 = (v: string) => Math.round(Number(v) * 100) / 100;

    async function check() {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/wallet/balance", { cache: "no-store" });
        const data = (await res.json()) as Snapshot;
        if (cancelled || !data.signedIn || !data.address || data.usdc == null) return;

        const addr = data.address;
        const current = round2(data.usdc);
        const key = SEEN_KEY(addr);
        const stored = localStorage.getItem(key);
        const baseline = stored == null ? null : Number(stored);

        if (baseline == null) {
          // First time we've seen this wallet — set the baseline silently.
          localStorage.setItem(key, String(current));
        } else if (current > baseline + 0.0001) {
          const delta = current - baseline;
          toast(
            "success",
            `You received ${delta.toFixed(2)} USDC. Your wallet balance is now ${current.toFixed(2)} USDC.`,
            "Deposit received"
          );
          localStorage.setItem(key, String(current));
        } else if (current < baseline) {
          // Spent/withdrew — quietly lower the baseline so the next top-up notifies.
          localStorage.setItem(key, String(current));
        }

        // If the spendable (gateway) balance grew, nudge the fuel gauge to refresh.
        if (data.gateway != null) {
          const g = round2(data.gateway);
          if (lastGatewayRef.current != null && g > lastGatewayRef.current + 0.0001) {
            window.dispatchEvent(new Event(PAY_SESSION_EVENT));
          }
          lastGatewayRef.current = g;
        }
      } catch {
        /* transient — try again next tick */
      }
    }

    check();
    const iv = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status, toast]);

  return null;
}
