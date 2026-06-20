"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEmbeddedWallet } from "@/lib/useEmbeddedWallet";
import { useToast } from "@/components/Toaster";
import ContentManager from "./ContentManager";
import EarningsPanel from "./EarningsPanel";
import WalletPanel from "./WalletPanel";

interface User {
  id: string;
  name: string | null;
  email: string;
  handle: string | null;
  walletLinked: boolean;
  wallet: string | null;
}

export default function DashboardClient({ user, impersonating }: { user: User; impersonating: boolean }) {
  const [tab, setTab] = useState<"content" | "earnings" | "wallet">("content");
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

      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 font-display-lg text-display-lg-mobile md:text-display-lg">Creator Dashboard</h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {user.handle ? `@${user.handle} · ` : ""}{user.email}
          </p>
        </div>
        <Link href="/dashboard/settings" className="btn-outline flex shrink-0 items-center gap-1 px-4 py-2 text-label-lg">
          <span className="material-symbols-outlined text-[18px]">settings</span>
          <span className="hidden sm:inline">Settings</span>
        </Link>
      </header>

      {!walletLinked && !impersonating && <WalletBanner onLinked={() => setWalletLinked(true)} />}

      <nav className="mb-8 flex gap-2 border-b border-outline-variant">
        {(["content", "earnings", "wallet"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t-lg px-4 py-2 font-label-lg capitalize ${tab === t ? "border-b-2 border-primary text-primary" : "text-on-surface-variant"}`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "content" ? (
        <ContentManager impersonating={impersonating} />
      ) : tab === "earnings" ? (
        <EarningsPanel impersonating={impersonating} walletLinked={walletLinked} />
      ) : (
        <WalletPanel impersonating={impersonating} />
      )}
    </div>
  );
}

function WalletBanner({ onLinked }: { onLinked: () => void }) {
  const [wallet, setWallet] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { address, isConnected } = useAccount();
  const editedRef = useRef(false); // don't clobber a manually-typed address
  const { status: emb, busy: embBusy, provision } = useEmbeddedWallet();
  const toast = useToast();
  const offerEmbedded = emb?.enabled !== false && !emb?.isAdmin;

  async function createFree() {
    try {
      await provision();
      toast("success", "Your free wallet is ready — payouts route here automatically.");
      onLinked();
    } catch (e) {
      toast("error", String((e as Error)?.message ?? e), "Couldn't create your wallet");
    }
  }

  // Auto-fill the payout address from the connected wallet (until the user
  // types their own).
  useEffect(() => {
    if (address && !editedRef.current) setWallet(address);
  }, [address]);

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
      <div className="mb-2 font-label-lg text-yellow-900">Set up your wallet to receive payments</div>
      {offerEmbedded && (
        <div className="mb-3">
          <button onClick={createFree} disabled={embBusy} className="btn-primary px-5 py-2 disabled:opacity-50">
            {embBusy ? "Creating…" : "Create your free wallet"}
          </button>
          <p className="mt-1 font-body-sm text-[12px] text-yellow-800">
            No download — secured by a PIN. Payouts route here automatically. Or paste your own address below.
          </p>
        </div>
      )}
      {!isConnected && (
        <div className="mb-3">
          <ConnectButton accountStatus="address" chainStatus="none" showBalance={false} />
          <p className="mt-1 font-body-sm text-[12px] text-yellow-800">Connect your wallet and we&apos;ll fill in your payout address automatically.</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          value={wallet}
          onChange={(e) => { editedRef.current = true; setWallet(e.target.value); }}
          placeholder="0x… your USDC payout address on Arc"
          className="flex-grow rounded-lg border border-outline px-3 py-2 font-data-mono text-body-sm"
        />
        <button onClick={link} disabled={busy || !wallet} className="btn-primary px-6 py-2">
          {busy ? "Validating…" : "Link wallet"}
        </button>
      </div>
      {isConnected && address && wallet.toLowerCase() === address.toLowerCase() && (
        <p className="mt-2 font-body-sm text-[12px] text-yellow-800">Using your connected wallet. Edit the field to use a different payout address.</p>
      )}
      {error && <p className="mt-2 font-body-sm text-[13px] text-red-600">{error}</p>}
    </div>
  );
}
