"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/Toaster";

/**
 * Follow / Unfollow control with an optional follower count. Reusable on the
 * creator profile (size="md", showCount) and in the following-feed suggestions
 * (size="sm").
 *
 * Behaviour:
 *   • Hidden entirely when viewing your OWN profile (button only — the count can
 *     still show via showCount).
 *   • Signed-out viewers see a Follow button that routes to /login.
 *   • Optimistic toggle; reverts + toasts on error.
 *   • Fetches live status on mount when `initialFollowing` isn't provided.
 */
export default function FollowButton({
  userId,
  initialFollowing,
  initialFollowerCount,
  showCount = false,
  size = "md",
  onChange,
}: {
  userId: string;
  initialFollowing?: boolean;
  initialFollowerCount?: number;
  showCount?: boolean;
  size?: "sm" | "md";
  onChange?: (following: boolean) => void;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const toast = useToast();

  const authed = status === "authenticated";
  const isOwn = authed && session?.user?.id === userId;

  const [following, setFollowing] = useState(!!initialFollowing);
  const [count, setCount] = useState<number | null>(initialFollowerCount ?? null);
  const [pending, setPending] = useState(false);
  // Until status resolves we don't know the true follow state; avoids a flash of
  // "Follow" on a profile you already follow.
  const [ready, setReady] = useState(initialFollowing !== undefined);

  // Pull live status once we know who's signed in.
  useEffect(() => {
    if (status === "loading") return;
    if (!authed) {
      setReady(true);
      return;
    }
    if (initialFollowing !== undefined) {
      setReady(true);
      return;
    }
    let alive = true;
    fetch(`/api/follows/${userId}/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setFollowing(!!d.following);
        setCount(typeof d.followerCount === "number" ? d.followerCount : null);
      })
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [authed, status, userId, initialFollowing]);

  async function toggle() {
    if (!authed) {
      router.push("/login");
      return;
    }
    if (pending) return;
    const next = !following;
    // Optimistic update.
    setFollowing(next);
    setCount((c) => (c == null ? c : Math.max(0, c + (next ? 1 : -1))));
    setPending(true);
    try {
      const res = next
        ? await fetch("/api/follows", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ followingId: userId }),
          })
        : await fetch(`/api/follows/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (typeof data.followerCount === "number") setCount(data.followerCount);
      onChange?.(next);
    } catch {
      // Revert.
      setFollowing(!next);
      setCount((c) => (c == null ? c : Math.max(0, c + (next ? -1 : 1))));
      toast("error", next ? "Couldn't follow. Try again." : "Couldn't unfollow. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (!ready) {
    // Light placeholder so layout doesn't jump.
    return showCount && count != null ? (
      <span className="font-body-sm text-body-sm text-on-surface-variant">{plural(count)}</span>
    ) : null;
  }

  const sm = size === "sm";
  const base = `inline-flex items-center justify-center gap-1 rounded-full font-label-caps text-label-caps transition-colors disabled:opacity-60 ${
    sm ? "px-3 py-1" : "px-4 py-1.5"
  }`;
  const style = following
    ? "border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"
    : "bg-primary text-on-primary hover:bg-primary/90";

  return (
    <div className="flex items-center gap-3">
      {!isOwn && (
        <button onClick={toggle} disabled={pending} className={`${base} ${style}`} aria-pressed={following}>
          {pending && (
            <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
          )}
          {following ? "Following" : "Follow"}
        </button>
      )}
      {showCount && count != null && (
        <span className="font-body-sm text-body-sm text-on-surface-variant">{plural(count)}</span>
      )}
    </div>
  );
}

function plural(n: number): string {
  return `${n} follower${n === 1 ? "" : "s"}`;
}
