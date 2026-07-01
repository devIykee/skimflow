"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useAccount } from "wagmi";

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

  // Unread notifications — polled here so the count shows on the profile avatar
  // and in the menu (the notification bell now lives inside this dropdown).
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (status !== "authenticated") return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/notifications/unread-count");
        if (!r.ok) return;
        const d = await r.json();
        if (alive && typeof d.unreadCount === "number") setUnread(d.unreadCount);
      } catch {
        /* transient */
      }
    };
    void load();
    const id = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [status]);
  const unreadBadge = unread <= 0 ? null : unread >= 10 ? "9+" : String(unread);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-outline-variant bg-surface-container-high text-on-surface transition-colors hover:bg-surface-container-highest"
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
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface bg-secondary" />
        )}
        {/* Unread-notifications badge. */}
        {signedIn && unreadBadge && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full border-2 border-surface bg-primary px-1 font-label-caps text-[9px] font-semibold text-on-primary">
            {unreadBadge}
          </span>
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
                <MenuLink
                  href="/notifications"
                  icon="notifications"
                  label="Notifications"
                  onClick={() => setOpen(false)}
                  badge={unreadBadge}
                />
                <MenuLink href="/dashboard" icon="dashboard" label="Creator dashboard" onClick={() => setOpen(false)} />
                <MenuLink
                  href={`/dashboard/settings?returnTo=${encodeURIComponent(pathname ?? "/dashboard")}`}
                  icon="settings"
                  label="Profile settings"
                  onClick={() => setOpen(false)}
                />
                {isAdmin && <MenuLink href="/admin" icon="shield_person" label="Admin console" onClick={() => setOpen(false)} />}
              </div>

              {/* Wallet connection lives in Profile settings now (the "Payout
                  wallet" section there), so it isn't duplicated in this menu. */}

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
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  label,
  onClick,
  badge,
}: {
  href: string;
  icon: string;
  label: string;
  onClick: () => void;
  badge?: string | null;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-2 font-label-lg text-label-lg text-on-surface hover:bg-surface-variant"
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      {label}
      {badge && (
        <span className="ml-auto flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 font-label-caps text-[10px] font-semibold text-on-primary">
          {badge}
        </span>
      )}
    </Link>
  );
}
