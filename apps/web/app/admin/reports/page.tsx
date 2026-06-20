"use client";

import { useCallback, useEffect, useState } from "react";

interface ReportRow {
  id: string;
  report_type: "broken_link" | "content_report";
  reason: string | null;
  detail: string | null;
  content_id: string | null;
  block_index: number | null;
  reporter_label: string | null;
  amount_paid: string | null;
  status: "open" | "reviewed" | "resolved" | "dismissed";
  created_at: string;
  content_title: string | null;
  content_slug: string | null;
  creator_handle: string | null;
}

const FILTERS: { key: string; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "reviewed", label: "Reviewed" },
  { key: "resolved", label: "Resolved" },
  { key: "dismissed", label: "Dismissed" },
  { key: "all", label: "All" },
];

export default function AdminReportsPage() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [filter, setFilter] = useState("open");
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const q = filter === "all" ? "" : `?status=${filter}`;
    fetch(`/api/admin/reports${q}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setReports(d.reports ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter]);
  useEffect(load, [load]);

  async function setStatus(id: string, status: string) {
    await fetch(`/api/admin/reports/${id}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`rounded-full px-4 py-1.5 font-label-caps text-label-caps transition-colors ${
              filter === f.key
                ? "bg-primary text-on-primary"
                : "border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && reports.length === 0 && <p className="font-body-sm text-on-surface-variant">Loading…</p>}
      {!loading && reports.length === 0 && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center">
          <p className="font-body-md text-on-surface-variant">No {filter === "all" ? "" : filter} reports.</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {reports.map((r) => (
          <div key={r.id} className="card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`pill ${r.report_type === "broken_link" ? "" : "!bg-primary/10 !text-primary"}`}>
                  {r.report_type === "broken_link" ? "Broken link" : "Content report"}
                </span>
                {r.reason && <span className="font-label-caps text-label-caps text-outline">{r.reason}</span>}
                <span className="font-data-mono text-[11px] text-outline">{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <span className="font-label-caps text-label-caps text-on-surface-variant">{r.status}</span>
            </div>

            <div className="font-body-sm text-body-sm">
              {r.content_slug ? (
                <a href={`/read/${r.content_slug}`} className="text-primary hover:underline">
                  {r.content_title ?? r.content_slug}
                </a>
              ) : (
                <span className="text-on-surface-variant">(content removed)</span>
              )}
              {r.block_index != null && <span className="text-outline"> · block {r.block_index}</span>}
              {r.creator_handle && <span className="text-outline"> · @{r.creator_handle}</span>}
              {r.amount_paid && <span className="text-outline"> · paid {Number(r.amount_paid).toFixed(2)} USDC</span>}
            </div>
            {r.detail && <p className="mt-1 font-body-sm text-[13px] text-on-surface-variant">{r.detail}</p>}
            {r.reporter_label && (
              <p className="mt-1 font-data-mono text-[11px] text-outline">reporter: {r.reporter_label}</p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {r.status !== "reviewed" && (
                <button onClick={() => setStatus(r.id, "reviewed")} className="btn-outline px-3 py-1 text-[11px]">
                  Mark reviewed
                </button>
              )}
              {r.status !== "resolved" && (
                <button onClick={() => setStatus(r.id, "resolved")} className="btn-outline px-3 py-1 text-[11px]">
                  Resolve
                </button>
              )}
              {r.status !== "dismissed" && (
                <button onClick={() => setStatus(r.id, "dismissed")} className="btn-outline px-3 py-1 text-[11px]">
                  Dismiss
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
