"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSession } from "next-auth/react";
import ComposerForm, { type ComposerCallbacks } from "./ComposerForm";

/**
 * Mobile floating action button → full-screen slide-up composer. Shown only on
 * mobile (desktop uses the sticky QuickComposer) and only when signed in. Sits
 * above the bottom nav.
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

  // Lock body scroll while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (status !== "authenticated") return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="New post"
        className="fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg transition-transform active:scale-95 md:hidden"
      >
        <span className="material-symbols-outlined text-[26px]">edit</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 bg-background md:hidden"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
          >
            <div className="flex items-center justify-between border-b border-outline-variant px-4 py-3">
              <span className="font-headline-sm text-[16px] font-semibold">New post</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="px-4 py-4">
              <ComposerForm
                surface={surface}
                callbacks={callbacks}
                variant="fullscreen"
                autoFocus
                onClose={() => setOpen(false)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
