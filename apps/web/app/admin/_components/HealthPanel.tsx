"use client";

import { useEffect, useState } from "react";

interface Health {
  database: { status: string; latency_ms: number };
  circle_gateway: { status: string; mode: string };
  payments_mode: string;
  redis: { status: string; mode: string };
  event_stream: { status: string; connected_clients: number };
  last_payment: { timestamp: string; amount: number } | null;
  last_signup: { timestamp: string } | null;
  env_warnings: string[];
}

function dot(status: string) {
  const color = status === "ok" ? "bg-green-500" : status === "degraded" || status === "unavailable" ? "bg-yellow-500" : "bg-red-500";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />;
}

export default function HealthPanel() {
  const [h, setH] = useState<Health | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const load = () =>
      fetch("/api/admin/health", { credentials: "include" }).then((r) => r.json()).then(setH).catch(() => {});
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="card">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between">
        <h2 className="font-headline-sm text-headline-sm">System Health</h2>
        <span className="text-on-surface-variant">{open ? "▾" : "▸"}</span>
      </button>
      {open && h && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Item label="Database" status={h.database.status} detail={`${h.database.latency_ms}ms`} />
          <Item label="Circle Gateway" status={h.circle_gateway.status} detail={h.circle_gateway.mode} />
          <Item label="Payments Mode" status={h.payments_mode === "live" ? "ok" : "degraded"} detail={h.payments_mode} />
          <Item label="Redis" status={h.redis.status} detail={h.redis.mode} />
          <Item label="Event Stream" status={h.event_stream.status} detail={`${h.event_stream.connected_clients} clients`} />
          <Item label="Last Payment" status={h.last_payment ? "ok" : "degraded"} detail={h.last_payment ? `$${h.last_payment.amount.toFixed(4)}` : "none"} />
        </div>
      )}
      {open && h && h.env_warnings.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1">
          {h.env_warnings.map((w, i) => (
            <li key={i} className="flex items-center gap-2 rounded bg-yellow-50 px-3 py-2 font-body-sm text-body-sm text-yellow-900"><span className="material-symbols-outlined text-[16px]">warning</span>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Item({ label, status, detail }: { label: string; status: string; detail: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-outline-variant px-3 py-2">
      {dot(status)}
      <div>
        <div className="font-label-caps text-label-caps text-on-surface-variant">{label}</div>
        <div className="font-data-mono text-[12px]">{detail}</div>
      </div>
    </div>
  );
}
