"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Header notification bell. Polls the unread count on mount and every 60s, and
 * navigates to /notifications on click. Badge shows the count under 10, or "9+"
 * for 10 and above. Rendered only for signed-in users (gated in the layout).
 */
export default function NotificationBell() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/notifications/unread-count");
        if (!r.ok) return;
        const d = await r.json();
        if (alive && typeof d.unreadCount === "number") setUnread(d.unreadCount);
      } catch {
        /* transient — try again on the next tick */
      }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const badge = unread <= 0 ? null : unread >= 10 ? "9+" : String(unread);

  return (
    <button
      onClick={() => router.push("/notifications")}
      aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
      className="relative flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant bg-surface-container-high text-on-surface transition-colors hover:bg-surface-container-highest"
    >
      <span className="material-symbols-outlined text-[20px]">notifications</span>
      {badge && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 font-label-caps text-[10px] font-semibold text-on-primary">
          {badge}
        </span>
      )}
    </button>
  );
}
