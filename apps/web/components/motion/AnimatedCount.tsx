"use client";

import { AnimatePresence, motion } from "framer-motion";

/**
 * A number that rolls when it changes (like/follower counts). Each value swap
 * slides the old digit out and the new one in — a small "it ticked" cue.
 * Respects reduced-motion via the app-wide MotionConfig.
 */
export default function AnimatedCount({ value, className }: { value: number; className?: string }) {
  return (
    <span className={`relative inline-flex overflow-hidden tabular-nums ${className ?? ""}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
