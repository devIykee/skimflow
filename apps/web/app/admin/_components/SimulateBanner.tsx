"use client";

import { useEffect, useState } from "react";

/** Prominent yellow banner shown on every admin page while in simulate mode. */
export default function SimulateBanner() {
  const [mode, setMode] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/health", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (alive) setMode(d.payments_mode);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (mode !== "simulate") return null;
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-yellow-400 bg-yellow-50 px-4 py-3 font-label-lg text-label-lg text-yellow-900">
      <span className="material-symbols-outlined text-[20px]">warning</span>
      Simulate mode active — no real payments are being processed.
    </div>
  );
}
