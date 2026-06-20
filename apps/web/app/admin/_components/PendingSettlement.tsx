"use client";

import { useCallback, useEffect, useState } from "react";

interface PendingRow {
  id: string;
  payment_token: string | null;
  created_at: string;
  content_title: string | null;
  creator_name: string | null;
  creator_handle: string | null;
  payer_kind: string;
  gross_amount: string;
  attestation: string | null;
}

const age = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
};

/**
 * Admin reconciliation for stuck (pending) payments. Silent-payment rows carry a
 * stored attestation and can be retried (mint→split) in one click; rows without
 * one (e.g. x402 batches) get Mark completed / Mark failed overrides.
 */
export default function PendingSettlement() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/admin/payments?status=pending`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setRows((d.rows ?? []) as PendingRow[]))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(token: string, action: string, txHash?: string) {
    setBusy(token);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/payments/${token}/settle`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, txHash }),
      });
      const data = await res.json();
      if (!res.ok) setMsg(data.message ?? data.error ?? "Failed.");
      else setMsg(action === "retry" ? "Settled ✓" : "Updated ✓");
      load();
    } finally {
      setBusy(null);
    }
  }

  async function retryAll() {
    setBusy("__all__");
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/payments/settle-all`, { method: "POST", credentials: "include" });
      const data = await res.json();
      setMsg(`Settled ${data.settled ?? 0}/${data.total ?? 0}.`);
      load();
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) return null;

  return (
    <div className="card !p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">sync_problem</span>
          <h2 className="font-headline-sm text-[15px] font-semibold">Pending settlement ({rows.length})</h2>
        </div>
        <button onClick={retryAll} disabled={busy === "__all__"} className="btn-primary px-3 py-1.5 text-[12px]">
          {busy === "__all__" ? "Retrying…" : "Retry all"}
        </button>
      </div>
      {msg && <p className="mb-2 font-body-sm text-[12px] text-on-surface-variant">{msg}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead className="font-label-caps text-label-caps text-on-surface-variant">
            <tr className="border-b border-outline">
              <th className="py-2">Age</th><th>Content</th><th>Creator</th><th>Kind</th><th>Gross</th><th>Retryable</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const token = r.payment_token;
              const retryable = !!r.attestation;
              return (
                <tr key={r.id} className="border-b border-outline-variant">
                  <td className="py-2 text-[12px]">{age(r.created_at)}</td>
                  <td className="max-w-[200px] truncate">{r.content_title ?? <span className="text-outline">— deleted</span>}</td>
                  <td>{r.creator_name ?? (r.creator_handle ? `@${r.creator_handle}` : "—")}</td>
                  <td><span className="pill">{r.payer_kind}</span></td>
                  <td>${Number(r.gross_amount).toFixed(4)}</td>
                  <td>{retryable ? <span className="text-secondary">yes</span> : <span className="text-outline">no</span>}</td>
                  <td className="flex flex-wrap gap-1 py-2">
                    {token && retryable && (
                      <button disabled={busy === token} onClick={() => act(token, "retry")} className="btn-outline px-2 py-1 text-[11px] text-secondary">
                        Retry settle
                      </button>
                    )}
                    {token && !retryable && (
                      <button
                        disabled={busy === token}
                        onClick={() => {
                          const tx = window.prompt("On-chain tx hash that settled this payment:");
                          if (tx) act(token, "mark_completed", tx.trim());
                        }}
                        className="btn-outline px-2 py-1 text-[11px]"
                      >
                        Mark completed
                      </button>
                    )}
                    {token && (
                      <button disabled={busy === token} onClick={() => act(token, "mark_failed")} className="btn-outline px-2 py-1 text-[11px] text-red-600">
                        Mark failed
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
