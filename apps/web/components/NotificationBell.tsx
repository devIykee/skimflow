"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { timeAgo } from "@/lib/time-ago";

// ─────────────────────────────────────────────────────────────────────────────
// Header notification bell. Polls the unread count every 20s. Clicking opens a
// rich dropdown (avatar + snippet per item) rather than navigating straight to
// the page. Badge shows the count under 10, or "9+".
// ─────────────────────────────────────────────────────────────────────────────

interface Actor {
  id: string;
  name: string | null;
  handle: string | null;
  avatarUrl: string | null;
}
interface Note {
  id: string;
  type: string;
  read: boolean;
  createdAt: string;
  actor: Actor | null;
  postSlug: string | null;
  postTitle: string | null;
  commentPreview: string | null;
  title: string | null;
  body: string | null;
  link: string | null;
}

function noteText(n: Note): string {
  const actor = n.actor?.name || (n.actor?.handle ? `@${n.actor.handle}` : "Someone");
  switch (n.type) {
    case "new_follower":
      return `${actor} started following you`;
    case "post_comment":
      return `${actor} commented on ${n.postTitle ?? "your post"}`;
    case "comment_reply":
      return `${actor} replied to your comment`;
    case "post_like":
      return `${actor} liked ${n.postTitle ?? "your post"}`;
    default:
      return n.title ?? "Notification";
  }
}
function noteHref(n: Note): string | null {
  switch (n.type) {
    case "new_follower":
      return n.actor ? `/creator/${n.actor.id}` : null;
    case "post_comment":
    case "comment_reply":
    case "post_like":
      return n.postSlug ? `/read/${n.postSlug}` : null;
    default:
      return n.link ?? null;
  }
}

export default function NotificationBell() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const loadCount = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications/unread-count");
      if (!r.ok) return;
      const d = await r.json();
      if (typeof d.unreadCount === "number") setUnread(d.unreadCount);
    } catch {
      /* transient */
    }
  }, []);

  // Poll unread count every 20s.
  useEffect(() => {
    void loadCount();
    const id = setInterval(loadCount, 20_000);
    return () => clearInterval(id);
  }, [loadCount]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      try {
        const r = await fetch("/api/notifications?limit=8");
        const d = await r.json();
        setItems(d.notifications ?? []);
        if (typeof d.unreadCount === "number") setUnread(d.unreadCount);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    }
  }

  function openItem(n: Note) {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      void fetch("/api/notifications/read", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationId: n.id }),
      }).catch(() => {});
    }
    const href = noteHref(n);
    setOpen(false);
    if (href) router.push(href);
  }

  const badge = unread <= 0 ? null : unread >= 10 ? "9+" : String(unread);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggleOpen}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant bg-surface-container-high text-on-surface transition-colors hover:bg-surface-container-highest"
      >
        <span className="material-symbols-outlined text-[20px]">notifications</span>
        {badge && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 font-label-caps text-[10px] font-semibold text-on-primary">
            {badge}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 z-[60] mt-2 w-80 overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-outline-variant px-4 py-2.5">
              <span className="font-headline-sm text-[14px] font-semibold">Notifications</span>
              <Link href="/notifications" onClick={() => setOpen(false)} className="font-label-caps text-label-caps text-primary hover:underline">
                See all
              </Link>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {loading && <p className="px-4 py-4 font-body-sm text-on-surface-variant">Loading…</p>}
              {!loading && items.length === 0 && (
                <p className="px-4 py-6 text-center font-body-sm text-on-surface-variant">No notifications yet.</p>
              )}
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-container-low ${
                    n.read ? "" : "bg-primary/5"
                  }`}
                >
                  <BellAvatar n={n} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-body-sm text-[13px] text-on-surface">{noteText(n)}</span>
                    {n.commentPreview && (
                      <span className="mt-0.5 line-clamp-1 block font-body-sm text-[12px] text-on-surface-variant">
                        “{n.commentPreview}”
                      </span>
                    )}
                    <span className="mt-0.5 block font-body-sm text-[11px] text-outline">{timeAgo(n.createdAt)}</span>
                  </span>
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BellAvatar({ n }: { n: Note }) {
  const src = n.actor?.avatarUrl;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />;
  }
  if (!n.actor) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
        <span className="material-symbols-outlined text-[16px]">notifications</span>
      </span>
    );
  }
  const initial = (n.actor.name ?? n.actor.handle ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-label-caps text-[12px] text-primary">
      {initial}
    </span>
  );
}
