"use client";

import { useSession } from "next-auth/react";
import { useToast } from "@/components/Toaster";

/**
 * Share a post. Builds an absolute link to the current reader page and, when
 * the viewer is signed in, appends `?ref=<their userId>` so any purchase made
 * by someone who follows the link credits them as the referrer (the referral
 * cookie is set by middleware on the first visit). Uses the native share sheet
 * on mobile, falling back to clipboard copy.
 */
export default function ShareButton({ slug, title }: { slug: string; title: string }) {
  const { data: session } = useSession();
  const toast = useToast();

  function buildUrl(): string {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = new URL(`/read/${slug}`, origin || "https://linepay-ten.vercel.app");
    const refId = session?.user?.id;
    if (refId) url.searchParams.set("ref", refId);
    return url.toString();
  }

  async function onShare() {
    const url = buildUrl();
    // Native share sheet (mobile) when available.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // user cancelled or unsupported payload → fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("success", session?.user?.id ? "Share link copied — you'll earn the referrer cut." : "Link copied to clipboard.");
    } catch {
      toast("error", "Couldn't copy the link — copy it from the address bar.");
    }
  }

  return (
    <button
      onClick={onShare}
      className="inline-flex items-center gap-1.5 font-label-caps text-label-caps text-outline transition-colors hover:text-primary"
      title="Share this post"
    >
      <span className="material-symbols-outlined text-[18px]">share</span>
      Share
    </button>
  );
}
