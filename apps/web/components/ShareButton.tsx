"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toaster";

/**
 * Share a post and earn the referrer cut on resulting purchases.
 *
 * Referral rewards require an account: the shareable link carries
 * `?ref=<userId>`, so a logged-out user has no id to credit. When logged out,
 * clicking Share routes to sign-in (returning to this page) instead of copying
 * an ineligible link. Signed in, it builds the ref link and uses the native
 * share sheet (mobile) or clipboard.
 */
export default function ShareButton({ slug, title }: { slug: string; title: string }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const toast = useToast();
  const loggedIn = !!session?.user?.id;

  function buildUrl(): string {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = new URL(`/read/${slug}`, origin || "https://skimflow-ten.vercel.app");
    url.searchParams.set("ref", session!.user!.id);
    return url.toString();
  }

  async function onShare() {
    // Gate: referral sharing needs an account so we can attribute the reward.
    if (!loggedIn) {
      toast("info", "Sign in to create your referral link and earn rewards when others read.");
      const callbackUrl = typeof window !== "undefined" ? window.location.href : `/read/${slug}`;
      router.push(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      return;
    }

    const url = buildUrl();
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
      toast("success", "Referral link copied — you'll earn the referrer cut when people read.");
    } catch {
      toast("error", "Couldn't copy the link — copy it from the address bar.");
    }
  }

  return (
    <button
      onClick={onShare}
      disabled={status === "loading"}
      className="inline-flex items-center gap-1.5 font-label-caps text-label-caps text-outline transition-colors hover:text-primary disabled:opacity-50"
      title={loggedIn ? "Share & earn referral rewards" : "Sign in to share and earn rewards"}
    >
      <span className="material-symbols-outlined text-[18px]">share</span>
      Share
    </button>
  );
}
