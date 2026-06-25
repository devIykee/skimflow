"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/Toaster";
import { formatUsdc } from "@/lib/money";

const explorer = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL || "https://testnet.arcscan.app";

interface Tx {
  id: string;
  kind: "incoming" | "outgoing";
  title: string;
  amount: string;
  status: string;
  createdAt: string | null;
  txHash: string | null;
}
interface Overview {
  isAdmin: boolean;
  walletSource: string;
  payoutAddress: string | null;
  embeddedAddress: string | null;
  hasEmbedded: boolean;
  fundingAddress: string | null;
  balance: { usdc: string; gas: string } | null;
  incoming: Tx[];
  outgoing: Tx[];
}

export default function WalletPanel({ impersonating }: { impersonating: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/wallet/overview", { credentials: "include" });
      if (r.ok) setData((await r.json()) as Overview);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 font-body-sm text-on-surface-variant">
        <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
        Loading your wallet…
      </div>
    );
  }
  if (!data) return <p className="py-8 font-body-sm text-on-surface-variant">Couldn’t load your wallet.</p>;

  const txns = [...data.incoming, ...data.outgoing].sort((a, b) =>
    (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Withdraw (embedded wallets only) */}
      {data.hasEmbedded && !data.isAdmin && (
        <WithdrawForm
          balance={data.balance?.usdc ?? "0"}
          disabled={impersonating}
          onDone={() => void load()}
        />
      )}

      {/* Payout-wallet / Connect-wallet management lives in Profile Settings only
          — it doesn't belong on the Wallet page. */}

      {/* Transaction history */}
      <div className="card">
        <h2 className="mb-4 font-headline-sm text-[15px] font-semibold">Transaction history</h2>
        {txns.length === 0 ? (
          <p className="font-body-sm text-on-surface-variant">No transactions yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-outline-variant">
            {txns.map((t) => (
              <div key={`${t.kind}-${t.id}`} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`material-symbols-outlined text-[18px] ${
                      t.kind === "incoming" ? "text-secondary" : "text-on-surface-variant"
                    }`}
                  >
                    {t.kind === "incoming" ? "south_west" : "north_east"}
                  </span>
                  <div>
                    <div className="font-body-sm text-[13px] text-on-surface">{t.title}</div>
                    <div className="font-body-sm text-[11px] text-outline">
                      {t.createdAt ? new Date(t.createdAt).toLocaleString() : ""} · {t.status}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`font-data-mono text-[13px] ${
                      t.kind === "incoming" ? "text-secondary" : "text-on-surface"
                    }`}
                  >
                    {t.kind === "incoming" ? "+" : "−"}
                    {formatUsdc(t.amount)} USDC
                  </div>
                  {t.txHash && (
                    <a
                      href={`${explorer}/tx/${t.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-data-mono text-[11px] text-primary hover:underline"
                    >
                      view
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Withdraw USDC from the user's wallet to an external address (server-signed). */
function WithdrawForm({
  balance,
  disabled,
  onDone,
}: {
  balance: string;
  disabled: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "pending" | "confirmed" | "failed">("idle");

  async function pollStatus(txId: string) {
    // Poll Circle for settlement; stop on a terminal state or after a cap.
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        const r = await fetch(`/api/wallet/tx-status?txId=${encodeURIComponent(txId)}`, {
          credentials: "include",
        });
        const d = await r.json();
        if (d.status === "confirmed") {
          setStatus("confirmed");
          toast("success", "Withdrawal confirmed.");
          onDone();
          return;
        }
        if (d.status === "failed") {
          setStatus("failed");
          toast("error", "Withdrawal failed. Funds were not sent.");
          return;
        }
      } catch {
        /* keep polling */
      }
    }
    // Still pending after the cap — leave it; the history list will reflect it.
    toast("info", "Withdrawal is still settling. Check history shortly.");
    onDone();
  }

  async function withdraw() {
    setBusy(true);
    setStatus("idle");
    try {
      const r = await fetch("/api/wallet/withdraw", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, destination }),
      });
      const d = await r.json();
      if (!r.ok) {
        toast("error", d.message ?? d.error ?? "Withdrawal couldn’t be started.");
        return;
      }
      // Signed server-side with the entity secret — no PIN. Poll for settlement.
      setStatus("pending");
      toast("info", "Withdrawal submitted. Settling on Arc…");
      setAmount("");
      setDestination("");
      await pollStatus(d.txId as string);
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e);
      toast("error", msg, "Withdrawal failed");
      setStatus("idle");
    } finally {
      setBusy(false);
    }
  }

  const amountNum = Number(amount);
  const valid = amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0 && destination.trim() !== "";

  return (
    <div className="card flex flex-col gap-3">
      <div>
        <h2 className="font-headline-sm text-[15px] font-semibold">Withdraw USDC</h2>
        <p className="font-body-sm text-[12px] text-outline">
          Send USDC from your wallet to any external address. Available: {formatUsdc(balance)} USDC.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label className="font-label-caps text-label-caps text-outline">Amount (USDC)</label>
        <div className="flex gap-2">
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy || disabled}
            placeholder="0.00"
            className="w-40 rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-data-mono text-on-surface focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setAmount(balance)}
            disabled={busy || disabled}
            className="btn-outline px-3 py-2 text-[12px]"
          >
            Max
          </button>
        </div>
        <label className="mt-1 font-label-caps text-label-caps text-outline">Destination address</label>
        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          disabled={busy || disabled}
          placeholder="0x…"
          className="w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-data-mono text-[13px] text-on-surface focus:border-primary focus:outline-none"
        />
      </div>
      {status === "pending" && (
        <p className="flex items-center gap-2 font-body-sm text-[13px] text-primary">
          <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
          Withdrawal in progress…
        </p>
      )}
      <button onClick={withdraw} disabled={!valid || busy || disabled} className="btn-primary px-5 py-2.5 disabled:opacity-50">
        {busy ? "Processing…" : "Withdraw"}
      </button>
      {disabled && <p className="font-body-sm text-[12px] text-outline">Withdrawals are disabled while impersonating.</p>}
    </div>
  );
}
