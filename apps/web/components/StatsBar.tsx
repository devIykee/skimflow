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
    const load = () => fetch("/api/stats").then((r) => r.json()).then(setS).catch(() => {});
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  if (!s || s.payments === 0) return null;

  const cells = [
    { label: "Paid to creators", value: s.toCreatorsDisplay },
    { label: "Nanopayments", value: s.payments.toLocaleString() },
    { label: "Lines sold", value: s.linesSold.toLocaleString() },
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
