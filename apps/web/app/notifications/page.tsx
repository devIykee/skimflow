"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { timeAgo } from "@/lib/time-ago";

// ─────────────────────────────────────────────────────────────────────────────
// Notifications — single 600px column, newest first. Unread rows are subtly
// highlighted; clicking a row marks it read and navigates to the related
// content. "Mark all as read" clears every unread row. Paginated (load more).
// Handles both social notifications and legacy (Ghost) title/body/link rows.
// ─────────────────────────────────────────────────────────────────────────────

interface Actor {
  id: string;
  name: string | null;
  handle: string | null;
  avatarUrl: string | null;
}

interface Notification {
  id: string;
  type: string;
  read: boolean;
  createdAt: string;
  actor: Actor | null;
  postId: string | null;
  postTitle: string | null;
  postSlug: string | null;
  commentId: string | null;
  commentPreview: string | null;
  title: string | null;
  body: string | null;
  link: string | null;
}

const PAGE = 20;

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [authError, setAuthError] = useState(false);
  const pageRef = useRef(1);
  const loadingRef = useRef(false);

  const fetchPage = useCallback(async (reset: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const page = reset ? 1 : pageRef.current;
    try {
      const res = await fetch(`/api/notifications?page=${page}&limit=${PAGE}`);
      if (res.status === 401) {
        setAuthError(true);
        setHasMore(false);
        return;
      }
      const data = await res.json();
      const rows: Notification[] = data.notifications ?? [];
      pageRef.current = page + 1;
      setHasMore(!!data.pagination?.hasMore);
      setItems((prev) => (reset ? rows : [...prev, ...rows]));
    } catch {
      setHasMore(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPage(true);
  }, [fetchPage]);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await fetch("/api/notifications/read", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch {
      /* best-effort */
    }
  }, []);

  const open = useCallback(
    (n: Notification) => {
      // Mark this one read (optimistic + fire-and-forget) then navigate.
      if (!n.read) {
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
        void fetch("/api/notifications/read", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ notificationId: n.id }),
        }).catch(() => {});
      }
      const href = targetHref(n);
      if (href) router.push(href);
    },
    [router]
  );

  const anyUnread = items.some((n) => !n.read);

  return (
    <div className="mx-auto max-w-[600px] px-margin-mobile py-stack-lg md:px-margin-desktop">
      <header className="mb-6 flex items-center justify-between gap-3">
        <h1 className="font-display-lg text-display-lg-mobile md:text-display-lg">Notifications</h1>
        {anyUnread && (
          <button
            onClick={markAllRead}
            className="shrink-0 font-label-caps text-label-caps text-primary hover:underline"
          >
            Mark all as read
          </button>
        )}
      </header>

      {loading && items.length === 0 && !authError && (
        <p className="font-body-sm text-on-surface-variant">Loading…</p>
      )}

      {authError && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center">
          <p className="mb-3 font-body-md text-on-surface-variant">Sign in to see your notifications.</p>
          <Link
            href="/login"
            className="inline-flex rounded-full bg-primary px-4 py-1.5 font-label-caps text-label-caps text-on-primary"
          >
            Sign in
          </Link>
        </div>
      )}

      {!loading && !authError && items.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-10 text-center">
          <span className="material-symbols-outlined text-[28px] text-outline">notifications</span>
          <h2 className="font-headline-sm text-headline-sm">no notifications yet</h2>
          <p className="max-w-sm font-body-sm text-body-sm text-on-surface-variant">
            when someone follows you or comments on your posts, you&apos;ll see it here
          </p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col divide-y divide-outline-variant overflow-hidden rounded-xl border border-outline-variant">
          {items.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => open(n)}
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-container-low ${
                  n.read ? "bg-surface" : "bg-primary/5"
                }`}
              >
                <Avatar n={n} />
                <div className="min-w-0 flex-1">
                  <NotificationText n={n} />
                  <Preview n={n} />
                  <p className="mt-0.5 font-body-sm text-[12px] text-outline">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => fetchPage(false)}
            disabled={loading}
            className="rounded-full border border-outline-variant px-4 py-1.5 font-label-caps text-label-caps text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Where clicking a notification should take the user. */
function targetHref(n: Notification): string | null {
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

function NotificationText({ n }: { n: Notification }) {
  const actor = n.actor?.name || (n.actor?.handle ? `@${n.actor.handle}` : "Someone");
  if (n.type === "new_follower") {
    return (
      <p className="font-body-md text-[14px] text-on-surface">
        <span className="font-semibold">{actor}</span> started following you
      </p>
    );
  }
  if (n.type === "post_comment") {
    return (
      <p className="font-body-md text-[14px] text-on-surface">
        <span className="font-semibold">{actor}</span> commented on{" "}
        <span className="font-semibold">{n.postTitle ?? "your post"}</span>
      </p>
    );
  }
  if (n.type === "comment_reply") {
    return (
      <p className="font-body-md text-[14px] text-on-surface">
        <span className="font-semibold">{actor}</span> replied to your comment
      </p>
    );
  }
  if (n.type === "post_like") {
    return (
      <p className="font-body-md text-[14px] text-on-surface">
        <span className="font-semibold">{actor}</span> liked{" "}
        <span className="font-semibold">{n.postTitle ?? "your post"}</span>
      </p>
    );
  }
  // Legacy (Ghost) notification.
  return (
    <p className="font-body-md text-[14px] text-on-surface">
      <span className="font-semibold">{n.title ?? "Notification"}</span>
      {n.body ? <span className="text-on-surface-variant"> — {n.body}</span> : null}
    </p>
  );
}

function Preview({ n }: { n: Notification }) {
  if ((n.type === "post_comment" || n.type === "comment_reply") && n.commentPreview) {
    return (
      <p className="mt-0.5 line-clamp-1 font-body-sm text-[13px] text-on-surface-variant">
        “{n.commentPreview}”
      </p>
    );
  }
  return null;
}

function Avatar({ n }: { n: Notification }) {
  const src = n.actor?.avatarUrl;
  const name = n.actor?.name ?? n.actor?.handle ?? null;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />;
  }
  // Legacy notifications have no actor → show a neutral bell glyph.
  if (!n.actor) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
        <span className="material-symbols-outlined text-[18px]">notifications</span>
      </span>
    );
  }
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-label-caps text-[13px] text-primary">
      {initial}
    </span>
  );
}
