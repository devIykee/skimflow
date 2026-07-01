"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/Toaster";
import AnimatedCount from "@/components/motion/AnimatedCount";

/**
 * Follow / Unfollow control with an optional animated follower count. Reusable
 * on the creator profile, feed cards, and suggested-creator lists.
 *
 * - Optimistic toggle (no server round-trip before the UI updates).
 * - "Following" swaps to "Unfollow" (warning tone) on hover — no confirm modal.
 * - Checkmark + scale pop on follow; toast "You're now following {Name}".
 * - Hidden on your OWN profile (button only; the count can still show).
 * - Signed-out taps route to /login.
 */
export default function FollowButton({
  userId,
  name,
  initialFollowing,
  initialFollowerCount,
  showCount = false,
  size = "md",
  onChange,
}: {
  userId: string;
  name?: string | null;
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
  const [ready, setReady] = useState(initialFollowing !== undefined);

  useEffect(() => {
    if (status === "loading") return;
    if (!authed || initialFollowing !== undefined) {
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
      if (next) toast("success", `You're now following ${name?.trim() || "this creator"}.`);
      onChange?.(next);
    } catch {
      setFollowing(!next);
      setCount((c) => (c == null ? c : Math.max(0, c + (next ? -1 : 1))));
      toast("error", next ? "Couldn't follow. Try again." : "Couldn't unfollow. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (!ready) {
    return showCount && count != null ? (
      <span className="font-body-sm text-body-sm text-on-surface-variant">{plural(count)}</span>
    ) : null;
  }

  const sm = size === "sm";
  const base = `group inline-flex items-center justify-center gap-1 rounded-full font-label-caps text-label-caps transition-colors disabled:opacity-60 ${
    sm ? "px-3 py-1" : "px-4 py-1.5"
  }`;
  const style = following
    ? "border border-outline-variant text-on-surface-variant hover:border-error hover:text-error"
    : "bg-primary text-on-primary hover:bg-primary/90";

  return (
    <div className="flex items-center gap-3">
      {!isOwn && (
        <motion.button
          onClick={toggle}
          disabled={pending}
          whileTap={{ scale: 0.95 }}
          className={`${base} ${style}`}
          aria-pressed={following}
        >
          {pending ? (
            <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
          ) : following ? (
            <>
              {/* Default: ✓ Following → on hover: Unfollow */}
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="inline-flex items-center gap-1 group-hover:hidden"
              >
                <span className="material-symbols-outlined text-[16px]">check</span>
                Following
              </motion.span>
              <span className="hidden group-hover:inline">Unfollow</span>
            </>
          ) : (
            "Follow"
          )}
        </motion.button>
      )}
      {showCount && count != null && (
        <span className="inline-flex items-center gap-1 font-body-sm text-body-sm text-on-surface-variant">
          <AnimatedCount value={count} className="font-semibold text-on-surface" />
          follower{count === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}

function plural(n: number): string {
  return `${n} follower${n === 1 ? "" : "s"}`;
}
