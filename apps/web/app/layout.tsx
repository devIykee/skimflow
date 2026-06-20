import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import Providers from "./providers";
import UserMenu from "@/components/UserMenu";
import MobileNav from "@/components/MobileNav";
import ThemeToggle from "@/components/ThemeToggle";

const SITE_NAME = "Skimflow";
const SITE_TAGLINE = "Skimflow — get paid every time someone reads a line";
const SITE_DESCRIPTION =
  "Per-line nanopayments for article writers and light-novel authors, with an autonomous reading agent. Built on x402 + Circle Gateway + Arc.";

export const metadata: Metadata = {
  title: SITE_TAGLINE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Playfair+Display:wght@600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=JetBrains+Mono:wght@500&display=swap"
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
            <nav className="mx-auto flex max-w-max-width items-center justify-between px-margin-mobile py-4 md:px-margin-desktop">
              <Link
                href="/"
                className="font-headline-sm text-headline-sm font-bold text-on-surface [&>span]:text-primary"
              >
                Skim<span>flow</span>
              </Link>
              <div className="hidden items-center gap-stack-lg md:flex">
                <NavLink href="/for-you">For You</NavLink>
                <NavLink href="/docs">Docs</NavLink>
              </div>
              <div className="flex items-center gap-stack-md">
                <ThemeToggle />
                <UserMenu />
              </div>
            </nav>
          </header>

          {/* pb on mobile keeps content clear of the fixed bottom nav. */}
          <main className="flex-grow pb-16 md:pb-0">{children}</main>

          <footer className="border-t border-outline-variant bg-surface-container-low">
            <div className="mx-auto flex max-w-max-width flex-col items-center justify-between gap-stack-md px-margin-mobile py-stack-lg md:flex-row md:px-margin-desktop">
              <div className="label-caps text-on-surface">SKIMFLOW</div>
              <div className="font-body-sm text-body-sm text-on-surface-variant">
                x402 · Circle Gateway · USDC on Arc
              </div>
              <div className="flex gap-gutter">
                <Link className="font-body-sm text-body-sm text-on-surface-variant hover:text-primary" href="/docs">Docs</Link>
                <Link className="font-body-sm text-body-sm text-on-surface-variant hover:text-primary" href="/for-you">For You</Link>
                <Link className="font-body-sm text-body-sm text-on-surface-variant hover:text-primary" href="/dashboard">Dashboard</Link>
              </div>
            </div>
          </footer>

          <MobileNav />
        </Providers>
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
