"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/Toaster";
import AnimatedCount from "./AnimatedCount";

/**
 * Heart like-button with an optimistic toggle, a fill + tap bounce, and an
 * animated count. Works for posts and comments. Safe to nest inside a card that
 * is itself a link (it stops click propagation). Signed-out taps route to login.
 */
export default function LikeButton({
  kind,
  id,
  initialLiked = false,
  initialCount = 0,
  size = "md",
}: {
  kind: "post" | "comment";
  id: string;
  initialLiked?: boolean;
  initialCount?: number;
  size?: "sm" | "md";
}) {
  const { status } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [pending, setPending] = useState(false);

  async function toggle(e: React.MouseEvent) {
    // Never let a like bubble up to a surrounding card link.
    e.preventDefault();
    e.stopPropagation();
    if (status !== "authenticated") {
      router.push("/login");
      return;
    }
    if (pending) return;
    const next = !liked;
    setLiked(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    setPending(true);
    const url = kind === "post" ? `/api/posts/${id}/like` : `/api/comments/${id}/like`;
    try {
      const res = await fetch(url, { method: next ? "POST" : "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (typeof d.likeCount === "number") setCount(d.likeCount);
    } catch {
      setLiked(!next);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
      toast("error", "Couldn't update your like.");
    } finally {
      setPending(false);
    }
  }

  const iconSize = size === "sm" ? "text-[16px]" : "text-[18px]";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={liked}
      aria-label={liked ? "Unlike" : "Like"}
      className={`inline-flex items-center gap-1 transition-colors ${
        liked ? "text-primary" : "text-on-surface-variant hover:text-primary"
      }`}
    >
      <motion.span
        whileTap={{ scale: 0.8 }}
        animate={liked ? { scale: [1, 1.3, 1] } : { scale: 1 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className={`material-symbols-outlined ${iconSize} ${
          liked ? "[font-variation-settings:'FILL'_1]" : ""
        }`}
      >
        favorite
      </motion.span>
      {count > 0 && <AnimatedCount value={count} className="font-body-sm text-[12px]" />}
    </button>
  );
}
