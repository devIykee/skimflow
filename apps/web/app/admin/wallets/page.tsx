"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Row {
  id: string;
  email: string;
  displayName: string | null;
  handle: string | null;
  role: string;
  embeddedAddress: string | null;
  externalAddress: string | null;
  payoutAddress: string | null;
  walletSource: string;
  fundingAddress: string | null;
  usdc: string | null;
  gas: string | null;
  createdAt: string;
}

type FundResult = { userId: string; ok: boolean; error?: string; gasTx?: string; usdcTx?: string };

function short(a: string | null): string {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function WalletsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [usdcAmount, setUsdcAmount] = useState("1");
  const [gasAmount, setGasAmount] = useState("0.5");
  const [funding, setFunding] = useState(false);
  const [results, setResults] = useState<Record<string, FundResult>>({});

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (sort) p.set("sort", sort);
    fetch(`/api/admin/wallets?${p}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, sort]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const fundable = useMemo(() => rows.filter((r) => r.fundingAddress), [rows]);
  const allSelected = fundable.length > 0 && fundable.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(fundable.map((r) => r.id)));
  }

  async function fund() {
    if (!selected.size) return;
    if (!window.confirm(`Send ${gasAmount || 0} gas + ${usdcAmount || 0} USDC to ${selected.size} user(s) from the relayer?`))
      return;
    setFunding(true);
    setResults({});
    try {
      const res = await fetch("/api/admin/fund", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [...selected], usdcAmount, gasAmount }),
      });
      const data = await res.json();
      if (data.results) {
        const map: Record<string, FundResult> = {};
        for (const r of data.results as FundResult[]) map[r.userId] = r;
        setResults(map);
      }
      load();
    } finally {
      setFunding(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Batch funding panel */}
      <div className="card !p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">savings</span>
          <h2 className="font-headline-sm text-[15px] font-semibold">Batch fund (relayer → users)</h2>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-label-caps text-label-caps text-on-surface-variant">USDC (each)</span>
            <input value={usdcAmount} onChange={(e) => setUsdcAmount(e.target.value)} type="number" min="0" step="0.01"
              className="w-28 rounded-lg border border-outline px-3 py-2 font-data-mono text-body-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label-caps text-label-caps text-on-surface-variant">Gas (each)</span>
            <input value={gasAmount} onChange={(e) => setGasAmount(e.target.value)} type="number" min="0" step="0.01"
              className="w-28 rounded-lg border border-outline px-3 py-2 font-data-mono text-body-sm" />
          </label>
          <button onClick={fund} disabled={funding || !selected.size} className="btn-primary px-4 py-2.5 disabled:opacity-50">
            {funding ? "Sending…" : `Fund ${selected.size || ""} selected`}
          </button>
          <p className="font-body-sm text-[12px] text-on-surface-variant">
            On Arc, gas (native, 18-dec) and USDC (ERC-20, 6-dec) are separate balances. Sent sequentially from the relayer.
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="mb-4 flex flex-wrap gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email / handle / address…"
            className="flex-grow rounded-lg border border-outline px-3 py-2 text-body-sm" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border border-outline px-3 py-2 text-body-sm">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="balance_asc">Lowest USDC first</option>
            <option value="balance_desc">Highest USDC first</option>
          </select>
          <button onClick={load} className="btn-outline px-3 py-2 text-body-sm">{loading ? "…" : "Refresh"}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-sm">
            <thead className="font-label-caps text-label-caps text-on-surface-variant">
              <tr className="border-b border-outline">
                <th className="py-2"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></th>
                <th>User</th><th>Embedded</th><th>External</th><th>USDC</th><th>Gas</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const r = results[u.id];
                return (
                  <tr key={u.id} className="border-b border-outline-variant">
                    <td className="py-2">
                      <input type="checkbox" disabled={!u.fundingAddress} checked={selected.has(u.id)} onChange={() => toggle(u.id)} aria-label={`Select ${u.email}`} />
                    </td>
                    <td>
                      <div className="font-medium">{u.displayName ?? u.handle ?? u.email}</div>
                      <div className="text-[11px] text-outline">{u.email}{u.role === "admin" ? " · admin" : ""}</div>
                    </td>
                    <td className="font-data-mono text-[12px]" title={u.embeddedAddress ?? ""}>{short(u.embeddedAddress)}</td>
                    <td className="font-data-mono text-[12px]" title={u.externalAddress ?? ""}>{short(u.externalAddress)}</td>
                    <td className="font-data-mono text-[12px]">{u.usdc ?? "—"}</td>
                    <td className="font-data-mono text-[12px]">{u.gas ?? "—"}</td>
                    <td className="text-[12px]">
                      {r ? (
                        r.ok ? <span className="text-secondary">funded ✓</span> : <span className="text-red-600" title={r.error}>failed</span>
                      ) : u.payoutAddress ? (
                        <span className="text-on-surface-variant">{u.walletSource}</span>
                      ) : (
                        <span className="text-outline">no wallet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={7} className="py-6 text-center text-on-surface-variant">No users.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
