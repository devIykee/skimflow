"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useEmbeddedWallet } from "@/lib/useEmbeddedWallet";
import { useToast } from "@/components/Toaster";

/**
 * Unified account control in the header. Nests two independent identities
 * behind a single profile icon:
 *   • the email/OAuth session (who you are as a creator), and
 *   • the connected wallet (where you get paid).
 * The heavy RainbowKit ConnectButton is only mounted when the menu opens, so
 * it doesn't cost anything on initial page paint.
 */
export default function UserMenu() {
  const { data: session, status } = useSession();
  const { isConnected } = useAccount();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  const user = session?.user;
  const signedIn = status === "authenticated" && !!user;
  const isAdmin = user?.role === "admin";
  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-surface/30 bg-surface/10 text-surface transition-colors hover:bg-surface/20"
      >
        {signedIn && user?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="h-full w-full object-cover" />
        ) : signedIn ? (
          <span className="font-headline-sm text-[15px] font-semibold">{initial}</span>
        ) : (
          <span className="material-symbols-outlined text-[20px]">person</span>
        )}
        {/* Wallet-connected indicator dot. */}
        {isConnected && (
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-inverse-surface bg-secondary" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-[60] mt-2 w-72 overflow-hidden rounded-xl border border-outline-variant bg-surface text-on-surface shadow-lg">
          {status === "loading" ? (
            <p className="px-4 py-4 font-body-sm text-on-surface-variant">Loading…</p>
          ) : signedIn ? (
            <>
              <div className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <p className="truncate font-headline-sm text-[14px] font-semibold">{user?.name ?? "Creator"}</p>
                  <span className="pill text-[10px]">{user?.role}</span>
                </div>
                <p className="truncate font-body-sm text-[12px] text-on-surface-variant">{user?.email}</p>
              </div>

              <div className="border-t border-outline-variant py-1">
                <MenuLink href="/dashboard" icon="dashboard" label="Creator dashboard" onClick={() => setOpen(false)} />
                <MenuLink
                  href={`/dashboard/settings?returnTo=${encodeURIComponent(pathname ?? "/dashboard")}`}
                  icon="settings"
                  label="Profile settings"
                  onClick={() => setOpen(false)}
                />
                {isAdmin && <MenuLink href="/admin" icon="shield_person" label="Admin console" onClick={() => setOpen(false)} />}
              </div>

              <div className="border-t border-outline-variant px-4 py-3">
                <p className="mb-2 font-label-caps text-label-caps text-on-surface-variant">Payout wallet</p>
                {/* Admins always use an external wallet; creators default to a free embedded one. */}
                {isAdmin ? (
                  <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
                ) : (
                  <EmbeddedWalletSection />
                )}
              </div>

              <div className="border-t border-outline-variant py-1">
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left font-label-lg text-label-lg text-primary hover:bg-surface-variant"
                >
                  <span className="material-symbols-outlined text-[18px]">logout</span>
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="px-4 py-3">
                <p className="font-headline-sm text-[14px] font-semibold">Not signed in</p>
                <p className="font-body-sm text-[12px] text-on-surface-variant">Sign in to publish and get paid.</p>
              </div>
              <div className="border-t border-outline-variant py-1">
                <MenuLink href="/login" icon="login" label="Creator sign-in" onClick={() => setOpen(false)} />
              </div>
              <div className="border-t border-outline-variant px-4 py-3">
                <p className="mb-2 font-label-caps text-label-caps text-on-surface-variant">Wallet</p>
                <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Creator payout wallet control: the auto-generated embedded wallet is the
 * default; bringing your own (RainbowKit) is the fallback. Provisioning creates
 * a non-custodial Circle wallet the user secures with a PIN.
 */
function EmbeddedWalletSection() {
  const { status: emb, busy, provision } = useEmbeddedWallet();
  const { isConnected } = useAccount();
  const toast = useToast();

  async function create() {
    try {
      await provision();
      toast("success", "Your free wallet is ready — payouts route here automatically.");
    } catch (e) {
      toast("error", String((e as Error)?.message ?? e), "Couldn't create your wallet");
    }
  }

  if (emb?.enabled === false) {
    // Embedded wallets not configured — fall back to external connect.
    return <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />;
  }

  if (emb?.hasWallet && emb.address) {
    return (
      <div>
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px] text-secondary">account_balance_wallet</span>
          <code className="font-data-mono text-[12px]">{emb.address.slice(0, 6)}…{emb.address.slice(-4)}</code>
          <span className="pill text-[10px]">free wallet</span>
        </div>
        <p className="mt-2 font-body-sm text-[11px] text-on-surface-variant">
          Payouts route here automatically. Prefer your own wallet?
        </p>
        <div className="mt-2"><ConnectButton showBalance={false} chainStatus="none" accountStatus="address" /></div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={create} disabled={busy} className="btn-primary w-full px-4 py-2 text-label-lg disabled:opacity-50">
        {busy ? "Creating…" : "Create your free wallet"}
      </button>
      <p className="mt-2 font-body-sm text-[11px] text-on-surface-variant">
        No download — secured by a PIN. Or bring your own:
      </p>
      <div className="mt-2"><ConnectButton showBalance={false} chainStatus="none" accountStatus="address" /></div>
      {isConnected && (
        <p className="mt-1 font-body-sm text-[11px] text-on-surface-variant">Connected wallet will be used for payouts.</p>
      )}
    </div>
  );
}

function MenuLink({ href, icon, label, onClick }: { href: string; icon: string; label: string; onClick: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-2 font-label-lg text-label-lg text-on-surface hover:bg-surface-variant"
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      {label}
    </Link>
  );
}
