"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSession } from "next-auth/react";
import ComposerForm, { type ComposerCallbacks } from "./ComposerForm";

/**
 * Floating "compose" button (Twitter-style) → opens the composer. On desktop it
 * opens a compact centered modal; on mobile a bottom sheet. Shown only when
 * signed in, and only on the pages that mount it (never on the reading page, so
 * it can't interfere while reading).
 */
export default function ComposerFab({
  surface,
  callbacks,
}: {
  surface: string;
  callbacks: ComposerCallbacks;
}) {
  const { status } = useSession();
  const [open, setOpen] = useState(false);

  // Lock body scroll while the composer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  if (status !== "authenticated") return null;

  return (
    <>
      {/* Floating circle: above the bottom nav on mobile, bottom-right on desktop. */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => setOpen(true)}
        aria-label="New post"
        className="fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg transition-shadow hover:shadow-xl md:bottom-8 md:right-8"
      >
        <span className="material-symbols-outlined text-[26px]">edit</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-start md:p-4 md:pt-[12vh]"
          >
            <motion.div
              key="panel"
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
              className="w-full rounded-t-2xl border border-outline-variant bg-surface shadow-xl md:max-w-xl md:rounded-2xl"
            >
              <div className="flex items-center justify-between border-b border-outline-variant px-4 py-3">
                <span className="font-headline-sm text-[15px] font-semibold">New post</span>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>
              <div className="px-4 py-4">
                <ComposerForm
                  surface={surface}
                  callbacks={callbacks}
                  variant="inline"
                  autoFocus
                  onClose={() => setOpen(false)}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
