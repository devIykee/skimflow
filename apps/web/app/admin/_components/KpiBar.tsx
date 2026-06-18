"use client";

import { useEffect, useState } from "react";

interface Metrics {
  totalRevenue: string;
  revenue24h: string;
  revenue24hPrev: string;
  platformEarnings: string;
  activeReaders: number;
  activeAgents: number;
  totalCreators: number;
  newCreators24h: number;
  newCreators24hPrev: number;
  publishedPieces: number;
  totalUnlocks: number;
  unlocks24h: number;
  unlocks24hPrev: number;
  pendingPayouts: string;
  hitRate402: number;
  reserveBalance: string;
  referrerPaid: string;
  pendingSettlement: string;
  failedPayments: number;
  agentRevenue: string;
  humanRevenue: string;
  verifiedPieces: number;
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0 && cur === 0) return null;
  const up = cur >= prev;
  const pct = prev === 0 ? 100 : Math.round(((cur - prev) / prev) * 100);
  return (
    <span className={up ? "text-green-600" : "text-red-600"}>
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

function Card({ label, value, delta }: { label: string; value: string; delta?: React.ReactNode }) {
  return (
    <div className="card !p-4">
      <div className="font-label-caps text-label-caps text-on-surface-variant">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-headline-sm text-headline-sm">{value}</span>
        {delta}
      </div>
    </div>
  );
}

const usd = (v: string | number) => `$${Number(v).toFixed(4)}`;

export default function KpiBar() {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/admin/metrics", { credentials: "include" })
        .then((r) => r.json())
        .then(setM)
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!m) return <div className="font-body-sm text-on-surface-variant">Loading metrics…</div>;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
      <Card label="Total Revenue" value={usd(m.totalRevenue)} />
      <Card label="Revenue 24h" value={usd(m.revenue24h)} delta={<Delta cur={Number(m.revenue24h)} prev={Number(m.revenue24hPrev)} />} />
      <Card label="Platform Earnings" value={usd(m.platformEarnings)} />
      <Card label="Reserve (USDC)" value={usd(m.reserveBalance)} />
      <Card label="Referrer Paid" value={usd(m.referrerPaid)} />
      <Card label="Pending Payouts" value={usd(m.pendingPayouts)} />
      <Card label="Pending Settlement" value={usd(m.pendingSettlement)} />
      <Card label="Agent Revenue" value={usd(m.agentRevenue)} />
      <Card label="Human Revenue" value={usd(m.humanRevenue)} />
      <Card label="Active Readers (60m)" value={String(m.activeReaders)} />
      <Card label="Active Agents (60m)" value={String(m.activeAgents)} />
      <Card label="Total Creators" value={String(m.totalCreators)} />
      <Card label="New Creators 24h" value={String(m.newCreators24h)} delta={<Delta cur={m.newCreators24h} prev={m.newCreators24hPrev} />} />
      <Card label="Published Pieces" value={String(m.publishedPieces)} />
      <Card label="Verified Pieces" value={String(m.verifiedPieces)} />
      <Card label="Total Unlocks" value={String(m.totalUnlocks)} />
      <Card label="Unlocks 24h" value={String(m.unlocks24h)} delta={<Delta cur={m.unlocks24h} prev={m.unlocks24hPrev} />} />
      <Card label="Failed Payments" value={String(m.failedPayments)} />
      <Card label="402 Hit Rate" value={`${m.hitRate402}%`} />
    </div>
  );
}
