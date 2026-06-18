"use client";

import { useEffect, useState } from "react";

interface RelayerInfo {
  address: string | null;
  live: boolean;
  usdc: string | null;
  gas: string | null;
  lowBalance: boolean;
  explorerUrl: string | null;
  faucetUrl: string;
}

/**
 * Admin panel: the relayer wallet that fronts gas + mint + split for live
 * silent payments. Shows its address (copyable) + balances + a top-up link,
 * and warns when it's running low.
 */
export default function RelayerCard() {
  const [r, setR] = useState<RelayerInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch("/api/admin/relayer", { credentials: "include" })
        .then((res) => res.json())
        .then(setR)
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!r || !r.address) return null;

  const copy = () => {
    navigator.clipboard?.writeText(r.address!).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={`card !p-4 ${r.lowBalance ? "border-2 border-primary/50" : ""}`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="font-label-caps text-label-caps text-on-surface-variant">
          Relayer wallet {r.live ? "· live" : "· simulate"}
        </div>
        {r.lowBalance && (
          <span className="flex items-center gap-1 font-label-caps text-label-caps text-primary">
            <span className="material-symbols-outlined text-[15px]">warning</span>low — top up
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="select-all break-all font-data-mono text-[13px] text-on-surface">{r.address}</code>
        <button onClick={copy} className="font-label-caps text-label-caps text-primary hover:underline">
          {copied ? "copied" : "copy"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 font-data-mono text-[13px]">
        <span>
          <span className="text-on-surface-variant">USDC </span>
          <span className={r.lowBalance ? "text-primary" : "text-secondary"}>{r.usdc ?? "—"}</span>
        </span>
        <span>
          <span className="text-on-surface-variant">gas </span>
          <span>{r.gas ?? "—"}</span>
        </span>
        <a href={r.faucetUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          fund at faucet ↗
        </a>
        {r.explorerUrl && (
          <a href={r.explorerUrl} target="_blank" rel="noreferrer" className="text-on-surface-variant hover:text-primary">
            arcscan ↗
          </a>
        )}
      </div>

      <p className="mt-2 font-body-sm text-[12px] text-on-surface-variant">
        This wallet pays Arc gas and fronts each live silent payment (gatewayMint → RevenueSplit.split). Keep it funded with test USDC.
      </p>
    </div>
  );
}
