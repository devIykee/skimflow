"use client";

import { useEffect, useState } from "react";

interface Stats {
  volumeDisplay: string;
  toCreatorsDisplay: string;
  payments: number;
  humanPayments: number;
  agentPayments: number;
  linesSold: number;
  creators: number;
}

/** Live traction bar shown on the home hero — real volume during the event. */
export default function StatsBar() {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = () => {
      // Don't poll a hidden tab — saves the DB from a constant query stream.
      if (document.visibilityState === "hidden") return;
      fetch("/api/stats").then((r) => r.json()).then((d) => !stopped && setS(d)).catch(() => {});
    };
    load();
    // 20s is plenty for a traction ticker; 4s saturated the connection pool.
    const id = setInterval(load, 20000);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (!s || s.payments === 0) return null;

  const cells = [
    { label: "Paid to creators", value: s.toCreatorsDisplay },
    { label: "Nanopayments", value: s.payments.toLocaleString() },
    { label: "Blocks sold", value: s.linesSold.toLocaleString() },
    { label: "By humans / agents", value: `${s.humanPayments} / ${s.agentPayments}` },
  ];

  return (
    <div className="mx-auto mt-stack-lg grid max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-xl border border-on-surface/10 bg-on-surface/10 sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="bg-surface-container-lowest p-4 text-center">
          <div className="font-data-mono text-body-md font-medium text-primary">{c.value}</div>
          <div className="mt-1 font-label-caps text-[10px] uppercase text-outline">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
