"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Row {
  id: string;
  email: string;
  display_name: string | null;
  avatar: string | null;
  role: string;
  wallet_address: string | null;
  suspended: boolean;
  created_at: string;
  content_count: number;
  total_earned: string;
}

const trunc = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

export default function UsersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (role) p.set("role", role);
    fetch(`/api/admin/users?${p}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setRows(d.rows ?? []);
        setTotal(d.total ?? 0);
      })
      .catch(() => {});
  }, [search, role]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function act(id: string, path: string, method = "POST") {
    setBusy(id);
    try {
      await fetch(`/api/admin/users/${id}/${path}`, { method, credentials: "include" });
      load();
    } finally {
      setBusy(null);
    }
  }

  async function impersonate(id: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/admin/users/${id}/impersonate`, { method: "POST", credentials: "include" });
      if (r.ok) window.location.href = "/dashboard";
    } finally {
      setBusy(null);
    }
  }

  async function resendWelcome(id: string, email: string) {
    if (!confirm(`Resend welcome email to ${email}?`)) return;
    setBusy(id);
    try {
      const r = await fetch(`/api/admin/users/${id}/resend-welcome`, { method: "POST", credentials: "include" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.message ?? "Failed to send welcome email.");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / email…" className="flex-grow rounded-lg border border-outline px-3 py-2 text-body-sm" />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-outline px-3 py-2 text-body-sm">
          <option value="">All roles</option>
          <option value="creator">Creators</option>
          <option value="admin">Admins</option>
        </select>
      </div>
      <p className="mb-2 font-body-sm text-on-surface-variant">{total} user(s)</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead className="font-label-caps text-label-caps text-on-surface-variant">
            <tr className="border-b border-outline">
              <th className="py-2">User</th><th>Role</th><th>Wallet</th><th>Content</th><th>Earned</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-outline-variant">
                <td className="py-2">
                  <div className="font-medium">{u.display_name ?? "—"}</div>
                  <div className="text-[11px] text-outline">{u.email}</div>
                </td>
                <td><span className="pill">{u.role}</span></td>
                <td className="font-data-mono text-[11px]">{trunc(u.wallet_address)}</td>
                <td>{u.content_count}</td>
                <td>${Number(u.total_earned).toFixed(4)}</td>
                <td>{u.suspended ? <span className="text-red-600">suspended</span> : "active"}</td>
                <td className="flex flex-wrap gap-1 py-2">
                  {u.suspended ? (
                    <button disabled={busy === u.id} onClick={() => act(u.id, "unsuspend")} className="btn-outline px-2 py-1 text-[11px]">Unsuspend</button>
                  ) : (
                    <button disabled={busy === u.id} onClick={() => act(u.id, "suspend")} className="btn-outline px-2 py-1 text-[11px]">Suspend</button>
                  )}
                  {u.role !== "admin" && (
                    <button disabled={busy === u.id} onClick={() => act(u.id, "grant-admin")} className="btn-outline px-2 py-1 text-[11px]">Grant Admin</button>
                  )}
                  <Link href={`/admin/email?userId=${u.id}`} className="btn-outline px-2 py-1 text-[11px]">Email</Link>
                  <button disabled={busy === u.id} onClick={() => resendWelcome(u.id, u.email)} className="btn-outline px-2 py-1 text-[11px]">Resend welcome</button>
                  <button disabled={busy === u.id} onClick={() => impersonate(u.id)} className="btn-outline px-2 py-1 text-[11px]">Impersonate</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
