import type { Metadata } from "next";
import Link from "next/link";

// Fully static + self-contained so the service worker can always serve it with
// no network (it's the navigation fallback for routes that aren't cached yet).
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-margin-mobile py-32 text-center md:px-margin-desktop">
      <span className="material-symbols-outlined text-[40px] text-outline">cloud_off</span>
      <h1 className="font-headline-sm text-headline-sm">You&apos;re offline</h1>
      <p className="font-body-md text-on-surface-variant">
        This page isn&apos;t cached for offline use yet. Pages you&apos;ve already opened still work without a
        connection, and any draft you save now will sync automatically when you&apos;re back online.
      </p>
      <Link href="/" className="btn-primary px-5 py-2">
        Go to home
      </Link>
    </div>
  );
}
