"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Row {
  id: string;
  title: string;
  slug: string;
  content_type: string;
  price_per_block: string;
  status: string;
  creator_handle: string | null;
  creator_name: string | null;
  published_at: string | null;
  total_earned: string;
}

export default function ContentPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (status) p.set("status", status);
    fetch(`/api/admin/content?${p}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []))
      .catch(() => {});
  }, [search, status]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function suspend(id: string, reason: string) {
    setBusy(id);
    try {
      await fetch(`/api/admin/content/${id}/suspend`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      load();
    } finally {
      setBusy(null);
    }
  }
  /** One-click hide from the For You feed (suspend with a default reason). */
  function hide(id: string) {
    return suspend(id, "Hidden from feed by admin");
  }
  async function reinstate(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/admin/content/${id}/reinstate`, { method: "POST", credentials: "include" });
      load();
    } finally {
      setBusy(null);
    }
  }
  async function del(id: string) {
    if (!window.confirm("Delete this content permanently?")) return;
    setBusy(id);
    try {
      await fetch(`/api/admin/content/${id}`, { method: "DELETE", credentials: "include" });
      load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title / slug…" className="flex-grow rounded-lg border border-outline px-3 py-2 text-body-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-outline px-3 py-2 text-body-sm">
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead className="font-label-caps text-label-caps text-on-surface-variant">
            <tr className="border-b border-outline">
              <th className="py-2">Title</th><th>Creator</th><th>Type</th><th>Price</th><th>Earned</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-outline-variant">
                <td className="py-2">
                  <div className="font-medium">{c.title}</div>
                  <div className="text-[11px] text-outline">/{c.slug}</div>
                </td>
                <td>@{c.creator_handle ?? "—"}</td>
                <td><span className="pill">{c.content_type}</span></td>
                <td>${Number(c.price_per_block).toFixed(4)}</td>
                <td>${Number(c.total_earned).toFixed(4)}</td>
                <td>
                  {c.status === "suspended" ? (
                    <span className="inline-flex items-center gap-1 text-red-600"><span className="material-symbols-outlined text-[14px]">visibility_off</span>hidden</span>
                  ) : c.status === "published" ? (
                    <span className="text-secondary">on feed</span>
                  ) : (
                    c.status
                  )}
                </td>
                <td className="flex flex-wrap gap-1 py-2">
                  <Link href={`/read/${c.slug}`} className="btn-outline px-2 py-1 text-[11px]">View</Link>
                  {c.status === "suspended" ? (
                    <button disabled={busy === c.id} onClick={() => reinstate(c.id)} className="btn-outline px-2 py-1 text-[11px] text-secondary">Show on feed</button>
                  ) : (
                    <button disabled={busy === c.id} onClick={() => hide(c.id)} className="btn-outline px-2 py-1 text-[11px]" title="Remove from the For You feed">Hide from feed</button>
                  )}
                  <button disabled={busy === c.id} onClick={() => del(c.id)} className="btn-outline px-2 py-1 text-[11px] text-red-600">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
