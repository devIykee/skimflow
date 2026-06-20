"use client";

import { useCallback, useEffect, useState } from "react";
import PendingSettlement from "../_components/PendingSettlement";

interface Row {
  id: string;
  created_at: string;
  content_id: string | null;
  content_title: string | null;
  content_slug: string | null;
  creator_name: string | null;
  creator_handle: string | null;
  payer_id: string | null;
  payer_kind: string;
  block_index: number | null;
  gross_amount: string;
  creator_amount: string;
  platform_amount: string;
  referrer_amount: string;
  tx_hash: string | null;
  status: string;
}
interface Totals { count: number; gross: string; creator: string; platform: string; referrer: string }

const explorer = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL || "https://testnet.arcscan.app";
const trunc = (s: string | null) => (s ? `${s.slice(0, 8)}…` : "—");

export default function PaymentsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (kind) p.set("payerKind", kind);
    if (status) p.set("status", status);
    if (search) p.set("search", search);
    fetch(`/api/admin/payments?${p}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setRows(d.rows ?? []);
        setTotals(d.totals ?? null);
      })
      .catch(() => {});
  }, [kind, status, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function exportCsv() {
    setExporting(true);
    try {
      const r = await fetch(`/api/admin/payments/export?format=csv`, { credentials: "include" });
      if (r.status === 202) {
        const { jobId } = await r.json();
        // Poll the async job until ready.
        for (;;) {
          await new Promise((res) => setTimeout(res, 2000));
          const s = await (await fetch(`/api/admin/payments/export/${jobId}/status`, { credentials: "include" })).json();
          if (s.ready) {
            window.location.href = s.downloadUrl;
            break;
          }
          if (s.status === "failed") break;
        }
      } else {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "payments-export.csv";
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
    <PendingSettlement />
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tx / address / title / creator…" className="flex-grow rounded-lg border border-outline px-3 py-2 text-body-sm" />
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border border-outline px-3 py-2 text-body-sm">
          <option value="">All payers</option>
          <option value="human">Human</option>
          <option value="agent">Agent</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-outline px-3 py-2 text-body-sm">
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
        <button onClick={exportCsv} disabled={exporting} className="btn-filled px-4 py-2 text-label-lg">
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead className="font-label-caps text-label-caps text-on-surface-variant">
            <tr className="border-b border-outline">
              <th className="py-2">Time</th><th>Content</th><th>Creator</th><th>Payer</th><th>Block</th><th>Gross</th><th>To creator</th><th>Platform</th><th>Referrer</th><th>Tx</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-outline-variant">
                <td className="py-2 text-[11px]">{new Date(p.created_at).toLocaleString()}</td>
                <td className="max-w-[200px]">
                  {p.content_title ? (
                    p.content_slug ? (
                      <a className="text-primary hover:underline" href={`/read/${p.content_slug}`} target="_blank" rel="noreferrer">{p.content_title}</a>
                    ) : (
                      p.content_title
                    )
                  ) : (
                    <span className="text-outline">— deleted</span>
                  )}
                </td>
                <td>{p.creator_name ?? (p.creator_handle ? `@${p.creator_handle}` : <span className="text-outline">—</span>)}</td>
                <td className="font-data-mono text-[11px]">
                  <span className="inline-flex items-center gap-1">
                    {p.payer_kind === "agent" && <span className="material-symbols-outlined text-[14px] text-blue-600" title="Agent">smart_toy</span>}
                    {trunc(p.payer_id)}
                  </span>
                </td>
                <td>{p.block_index}</td>
                <td>${Number(p.gross_amount).toFixed(4)}</td>
                <td>${Number(p.creator_amount).toFixed(4)}</td>
                <td>${Number(p.platform_amount).toFixed(4)}</td>
                <td>${Number(p.referrer_amount).toFixed(4)}</td>
                <td>{p.tx_hash ? <a className="text-primary" href={`${explorer}/tx/${p.tx_hash}`} target="_blank" rel="noreferrer">{trunc(p.tx_hash)}</a> : "—"}</td>
                <td>{p.status}</td>
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot>
              <tr className="border-t-2 border-outline font-medium">
                <td className="py-2" colSpan={5}>{totals.count} completed</td>
                <td>${Number(totals.gross).toFixed(4)}</td>
                <td>${Number(totals.creator).toFixed(4)}</td>
                <td>${Number(totals.platform).toFixed(4)}</td>
                <td>${Number(totals.referrer).toFixed(4)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
    </div>
  );
}
