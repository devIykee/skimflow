"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUsdc } from "@/lib/money";
import { useToast } from "@/components/Toaster";

interface BalanceData {
  signedIn: boolean;
  address: string | null;
  usdc: string | null;
  gateway: string | null;
}

/**
 * Primary dashboard block: the user's USDC balance, front and centre (Opay-style).
 *
 * IF the wallet is set up (always true after the dev-controlled migration, since
 * a wallet is auto-provisioned at signup) → show the balance boldly. ELSE (still
 * loading, or the rare case where provisioning hasn't landed) → a skeleton, never
 * a broken/empty UI.
 */
export default function BalanceHero() {
  const toast = useToast();
  const [data, setData] = useState<BalanceData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function copyAddress() {
    if (!data?.address) return;
    try {
      await navigator.clipboard.writeText(data.address);
      toast("success", "Address copied.");
    } catch {
      toast("error", "Couldn’t copy. Select it manually.");
    }
  }

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/wallet/balance", { credentials: "include" });
      if (r.ok) setData((await r.json()) as BalanceData);
    } catch {
      /* keep last known */
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ready = data?.address && data?.usdc != null;

  return (
    <div className="mb-6 rounded-2xl border border-outline-variant bg-gradient-to-br from-primary/10 via-surface to-surface p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-label-caps text-label-caps text-on-surface-variant">USDC balance</div>
          {ready ? (
            <div className="mt-1 font-display-lg text-display-lg-mobile font-bold leading-none text-on-surface md:text-display-lg">
              {formatUsdc(data!.usdc!)}
              <span className="ml-2 align-middle font-body-md text-[16px] font-normal text-outline">USDC</span>
            </div>
          ) : (
            // Skeleton — never a broken/zero flash while the balance loads.
            <div className="mt-2 h-10 w-48 animate-pulse rounded-lg bg-on-surface/10" />
          )}
          {ready && data!.gateway != null && (
            <div className="mt-2 font-body-sm text-[12px] text-on-surface-variant">
              Reading fuel: {formatUsdc(data!.gateway!)} USDC
            </div>
          )}
          {ready && data!.address && (
            <button
              onClick={copyAddress}
              title="Copy wallet address"
              className="group mt-1 inline-flex items-center gap-1 font-data-mono text-[11px] text-outline transition-colors hover:text-primary"
            >
              {data!.address!.slice(0, 10)}…{data!.address!.slice(-6)}
              <span className="material-symbols-outlined text-[14px] opacity-60 group-hover:opacity-100">content_copy</span>
            </button>
          )}
        </div>
        <button
          onClick={() => void load()}
          disabled={refreshing}
          className="btn-outline shrink-0 px-3 py-1.5 text-[12px] disabled:opacity-50"
        >
          {refreshing ? "…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
