"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUsdc } from "@/lib/money";

interface Earnings { totalEarned: string; pendingPayout: string; todayEarned: string; unlocks: number }
interface Payout { id: string; amount: string; wallet_address: string; tx_hash: string | null; status: string; created_at: string }

const explorer = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL || "https://testnet.arcscan.app";

export default function EarningsPanel({ impersonating, walletLinked }: { impersonating: boolean; walletLinked: boolean }) {
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/creator/earnings", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setEarnings(d.earnings ?? null);
        setPayouts(d.payouts ?? []);
      })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function requestPayout() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/creator/payout", { method: "POST", credentials: "include" });
      const d = await r.json();
      setMsg(r.ok ? `Payout of ${formatUsdc(d.payout.amount)} USDC initiated.` : d.message ?? "Payout failed");
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!earnings) return <p className="font-body-sm text-on-surface-variant">Loading earnings…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Stat label="Total earned (all time)" value={`${formatUsdc(earnings.totalEarned)} USDC`} />
        <Stat label="Pending payout" value={`${formatUsdc(earnings.pendingPayout)} USDC`} />
        <Stat label="Earned today" value={`${formatUsdc(earnings.todayEarned)} USDC`} />
      </div>

      <div className="card">
        <div className="flex items-center justify-between">
          <h2 className="font-headline-sm text-headline-sm">Payout</h2>
          <button
            onClick={requestPayout}
            disabled={busy || impersonating || !walletLinked || Number(earnings.pendingPayout) <= 0}
            title={!walletLinked ? "Link a wallet first" : impersonating ? "Not available in impersonation mode" : ""}
            className="btn-primary px-6 py-2"
          >
            {busy ? "Requesting…" : "Request Payout"}
          </button>
        </div>
        {msg && <p className="mt-2 font-body-sm text-secondary">{msg}</p>}
        {!walletLinked && <p className="mt-2 font-body-sm text-yellow-700">Link a payout wallet to withdraw.</p>}
      </div>

      <div className="card">
        <h2 className="mb-4 font-headline-sm text-headline-sm">Payout history</h2>
        <table className="w-full text-left text-body-sm">
          <thead className="font-label-caps text-label-caps text-on-surface-variant">
            <tr className="border-b border-outline"><th className="py-2">Date</th><th>Amount</th><th>Status</th><th>Tx</th></tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className="border-b border-outline-variant">
                <td className="py-2 text-[12px]">{new Date(p.created_at).toLocaleString()}</td>
                <td>{formatUsdc(p.amount)} USDC</td>
                <td>{p.status}</td>
                <td>{p.tx_hash ? <a className="text-primary" href={`${explorer}/tx/${p.tx_hash}`} target="_blank" rel="noreferrer">{p.tx_hash.slice(0, 10)}…</a> : "—"}</td>
              </tr>
            ))}
            {payouts.length === 0 && <tr><td colSpan={4} className="py-4 text-on-surface-variant">No payouts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card !p-4">
      <div className="font-label-caps text-label-caps text-on-surface-variant">{label}</div>
      <div className="mt-1 font-headline-sm text-headline-sm">{value}</div>
    </div>
  );
}
