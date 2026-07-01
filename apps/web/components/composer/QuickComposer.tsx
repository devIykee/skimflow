"use client";

import { useSession } from "next-auth/react";
import ComposerForm, { type ComposerCallbacks } from "./ComposerForm";

/**
 * Sticky inline composer pinned to the top of a feed (desktop). Hidden on mobile
 * (the FAB takes over) and for signed-out visitors. Sits just under the sticky
 * header.
 */
export default function QuickComposer({
  surface,
  callbacks,
}: {
  surface: string;
  callbacks: ComposerCallbacks;
}) {
  const { status } = useSession();
  if (status !== "authenticated") return null;
  return (
    <div className="sticky top-[68px] z-20 mb-5 hidden md:block">
      <div className="rounded-2xl border border-outline-variant bg-surface/95 p-4 shadow-sm backdrop-blur">
        <ComposerForm surface={surface} callbacks={callbacks} variant="inline" />
      </div>
    </div>
  );
}
