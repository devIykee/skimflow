"use client";

import { useState } from "react";
import ContentManager from "./ContentManager";
import EarningsPanel from "./EarningsPanel";

interface User {
  id: string;
  name: string | null;
  email: string;
  handle: string | null;
  walletLinked: boolean;
  wallet: string | null;
}

export default function DashboardClient({ user, impersonating }: { user: User; impersonating: boolean }) {
  const [tab, setTab] = useState<"content" | "earnings">("content");
  const [walletLinked, setWalletLinked] = useState(user.walletLinked);

  return (
    <div className="mx-auto max-w-max-width px-margin-mobile py-stack-md md:px-margin-desktop">
      {impersonating && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-orange-400 bg-orange-50 px-4 py-3 text-orange-900">
          <span className="flex items-center gap-2"><span className="material-symbols-outlined text-[18px]">warning</span>You are viewing as {user.name ?? user.email} — actions are disabled.</span>
          <button
            onClick={async () => {
              await fetch("/api/admin/impersonate", { method: "DELETE", credentials: "include" });
              window.location.href = "/admin/users";
            }}
            className="btn-outline px-3 py-1 text-label-lg"
          >
            Exit Impersonation
          </button>
        </div>
      )}

      <header className="mb-6">
        <h1 className="mb-1 font-display-lg text-display-lg-mobile md:text-display-lg">Creator Dashboard</h1>
        <p className="font-body-sm text-body-sm text-on-surface-variant">{user.email}</p>
      </header>

      {!walletLinked && !impersonating && <WalletBanner onLinked={() => setWalletLinked(true)} />}

      <nav className="mb-8 flex gap-2 border-b border-outline-variant">
        {(["content", "earnings"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t-lg px-4 py-2 font-label-lg capitalize ${tab === t ? "border-b-2 border-primary text-primary" : "text-on-surface-variant"}`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "content" ? <ContentManager impersonating={impersonating} /> : <EarningsPanel impersonating={impersonating} walletLinked={walletLinked} />}
    </div>
  );
}

function WalletBanner({ onLinked }: { onLinked: () => void }) {
  const [wallet, setWallet] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function link() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/creator/wallet", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      const d = await r.json();
      if (r.ok) onLinked();
      else setError(d.message ?? "Invalid wallet address.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-yellow-400 bg-yellow-50 px-4 py-4">
      <div className="mb-2 font-label-lg text-yellow-900">Add your wallet to receive payments</div>
      <div className="flex flex-wrap gap-2">
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="0x… your USDC payout address on Arc"
          className="flex-grow rounded-lg border border-outline px-3 py-2 font-data-mono text-body-sm"
        />
        <button onClick={link} disabled={busy || !wallet} className="btn-primary px-6 py-2">
          {busy ? "Validating…" : "Link wallet"}
        </button>
      </div>
      {error && <p className="mt-2 font-body-sm text-[13px] text-red-600">{error}</p>}
    </div>
  );
}
