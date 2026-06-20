"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useToast } from "@/components/Toaster";
import { useEmbeddedWallet } from "@/lib/useEmbeddedWallet";

/**
 * Payout-wallet management. Users can keep BOTH an embedded (free) wallet and an
 * external (connected) wallet, and choose which one receives payouts. Switching
 * only changes where FUTURE payments route — already-settled payouts keep the
 * address they were sent to, so history/in-flight payments are never affected.
 *
 * Shared between the Wallet tab and Profile settings.
 */
export default function PayoutWallet() {
  const toast = useToast();
  const { status: emb, busy: embBusy, provision, refresh } = useEmbeddedWallet();
  const { address, isConnected } = useAccount();
  const [working, setWorking] = useState(false);

  if (!emb) return null;
  if (emb.isAdmin) {
    return (
      <div className="card">
        <h2 className="mb-2 font-headline-sm text-[15px] font-semibold">Payout wallet</h2>
        <p className="mb-3 font-body-sm text-on-surface-variant">Admin accounts sign with an external wallet.</p>
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
      </div>
    );
  }

  async function useEmbeddedPayout() {
    setWorking(true);
    try {
      const r = await fetch("/api/creator/payout-source", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "embedded" }),
      });
      const d = await r.json();
      if (r.ok) { toast("success", "Payouts now route to your free wallet."); await refresh(); }
      else toast("error", d.friendly ?? d.error ?? "Couldn't switch.");
    } finally { setWorking(false); }
  }

  async function useExternalPayout() {
    if (!address) return;
    setWorking(true);
    try {
      const r = await fetch("/api/creator/payout-source", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "external", wallet: address }),
      });
      const d = await r.json();
      if (r.ok) { toast("success", "Payouts now route to your connected wallet."); await refresh(); }
      else toast("error", d.friendly ?? d.error ?? "Couldn't switch.");
    } finally { setWorking(false); }
  }

  async function createFree() {
    try { await provision(); toast("success", "Your free wallet is ready."); }
    catch (e) { toast("error", String((e as Error)?.message ?? e), "Couldn't create your wallet"); }
  }

  const active = emb.payoutAddress;
  const usingEmbedded = emb.walletSource === "embedded";

  return (
    <div className="card flex flex-col gap-4">
      <div>
        <h2 className="font-headline-sm text-[15px] font-semibold">Payout wallet</h2>
        <p className="font-body-sm text-on-surface-variant">
          Active payout: {active ? (
            <span className="font-data-mono text-[12px]">{active.slice(0, 6)}…{active.slice(-4)}</span>
          ) : <span className="text-outline">none yet</span>}
          {active && <span className="pill ml-2 text-[10px]">{emb.walletSource}</span>}
        </p>
        <p className="mt-1 font-body-sm text-[11px] text-outline">
          Switching only affects future payments — past and in-flight payouts keep their original destination.
        </p>
      </div>

      {/* Free embedded wallet */}
      <div className="rounded-lg border border-outline-variant p-3">
        <div className="mb-1 flex items-center gap-1.5 font-label-lg">
          <span className="material-symbols-outlined text-[18px] text-secondary">account_balance_wallet</span>
          Free wallet (recommended)
        </div>
        {emb.hasWallet ? (
          <>
            <code className="font-data-mono text-[12px]">{emb.address?.slice(0, 6)}…{emb.address?.slice(-4)}</code>
            {!usingEmbedded && (
              <button onClick={useEmbeddedPayout} disabled={working} className="btn-outline ml-3 px-3 py-1 text-[12px]">
                Use for payouts
              </button>
            )}
            {usingEmbedded && <span className="ml-3 font-body-sm text-[12px] text-secondary">in use ✓</span>}
          </>
        ) : (
          <button onClick={createFree} disabled={embBusy} className="btn-primary mt-1 px-4 py-1.5 text-[12px] disabled:opacity-50">
            {embBusy ? "Creating…" : "Create your free wallet"}
          </button>
        )}
      </div>

      {/* External wallet */}
      <div className="rounded-lg border border-outline-variant p-3">
        <div className="mb-2 font-label-lg">Your own wallet</div>
        <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />
        {isConnected && address && !usingEmbedded && emb.payoutAddress?.toLowerCase() === address.toLowerCase() ? (
          <span className="ml-3 font-body-sm text-[12px] text-secondary">in use ✓</span>
        ) : isConnected && address ? (
          <button onClick={useExternalPayout} disabled={working} className="btn-outline ml-3 px-3 py-1 text-[12px]">
            Use this for payouts
          </button>
        ) : null}
      </div>
    </div>
  );
}
