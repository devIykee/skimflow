import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import Providers from "./providers";
import UserMenu from "@/components/UserMenu";
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import MobileNav from "@/components/MobileNav";
import Footer from "@/components/Footer";
import ThemeToggle from "@/components/ThemeToggle";
import Logo from "@/components/Logo";
import { auth } from "@/auth";

const SITE_NAME = "Skimflow";
const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://skimflow.vercel.app").replace(/\/$/, "");
const SITE_TAGLINE = "Skimflow: pay-per-block reading for people and AI agents";
const SITE_DESCRIPTION =
  "Publish articles, serialized books, and picture stories (or AI agent skills) and earn USDC every time someone unlocks a block. Read the free preview, then tap to read on: frictionless micro-payments on Arc for humans and autonomous agents alike, powered by x402 + Circle Gateway.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // `%s · Skimflow` for child pages; the home page overrides with an absolute title.
  title: { default: SITE_TAGLINE, template: "%s · Skimflow" },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // Set NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION in the env to verify ownership in
  // Google Search Console via the meta-tag method (no tag emitted if unset).
  verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION },
  keywords: [
    "pay-per-block",
    "micropayments",
    "USDC",
    "Arc",
    "x402",
    "Circle Gateway",
    "serialized books",
    "web novels",
    "AI agent skills",
    "creator monetization",
  ],
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  openGraph: {
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    url: SITE_URL,
    type: "website",
    images: [{ url: "/logo.svg", width: 1200, height: 1200, alt: "Skimflow" }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
    images: ["/logo.svg"],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Auth-aware shell: signed-in users get the bottom nav (the authenticated app
  // shell); signed-out visitors get the marketing footer. They never co-render,
  // which also removes the bottom nav from the landing page and /login.
  const session = await auth();
  const authed = !!session?.user;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set the theme class before first paint to avoid a flash. Honors a
            saved preference, else the OS setting. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        {/* Agent payment discovery — lets crawling agents find the 402 system. */}
        <link rel="payment-manifest" href="/.well-known/agent-payment.json" />
      </head>
      <body className="bg-background font-body-md text-body-md text-on-surface antialiased min-h-screen flex flex-col selection:bg-primary-fixed selection:text-on-primary-fixed">
        <Providers>
          {/* Authoritative sticky header (DESIGN.md → Navigation). Uses surface
              tokens so it adapts cleanly in light + dark. */}
          <header className="sticky top-0 z-50 border-b border-outline-variant bg-surface/90 shadow-sm backdrop-blur">
            <nav className="relative mx-auto flex max-w-max-width items-center justify-between px-margin-mobile pb-4 pt-[max(1rem,env(safe-area-inset-top))] md:px-margin-desktop">
              <Link href="/" className="flex items-center gap-2" aria-label="Skimflow home">
                <Logo className="h-10 w-10 shrink-0" />
                <span className="font-headline-sm text-headline-sm font-bold text-on-surface [&>span]:text-primary">
                  Skim<span>flow</span>
                </span>
              </Link>
              {/* Absolutely centered so "For You" sits at the true center of the
                  header, independent of the logo and right-control widths. */}
              <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-stack-lg md:flex">
                <NavLink href="/for-you">For You</NavLink>
                {authed && <NavLink href="/following">Following</NavLink>}
                <NavLink href="/docs">Docs</NavLink>
              </div>
              <div className="flex items-center gap-stack-md">
                <ThemeToggle />
                <UserMenu />
              </div>
            </nav>
          </header>

          {/* pb on mobile keeps content clear of the fixed bottom nav (signed-in only). */}
          <main className={`flex-grow ${authed ? "pb-16 md:pb-0" : ""}`}>{children}</main>

          {authed ? <MobileNav /> : <Footer />}
        </Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="font-body-md text-body-md text-on-surface transition-colors hover:text-primary"
    >
      {children}
    </Link>
  );
}
