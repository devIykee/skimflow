import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import Providers from "./providers";
import WalletButton from "@/components/WalletButton";

export const metadata: Metadata = {
  title: "LinePay Cite — get paid every time someone reads a line",
  description:
    "Per-line nanopayments for article writers and light-novel authors, with an autonomous reading agent. Built on x402 + Circle Gateway + Arc.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Playfair+Display:wght@600;700&family=JetBrains+Mono:wght@500&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background font-body-md text-body-md text-on-surface antialiased min-h-screen flex flex-col selection:bg-primary-fixed selection:text-on-primary-fixed">
        <Providers>
          {/* Ink-colored authoritative sticky header (DESIGN.md → Navigation). */}
          <header className="sticky top-0 z-50 bg-inverse-surface shadow-sm">
            <nav className="mx-auto flex max-w-max-width items-center justify-between px-margin-mobile py-4 md:px-margin-desktop">
              <Link
                href="/"
                className="font-headline-sm text-headline-sm font-bold text-surface [&>span]:text-primary"
              >
                LinePay <span>Cite</span>
              </Link>
              <div className="hidden items-center gap-stack-lg md:flex">
                <NavLink href="/">Home</NavLink>
                <NavLink href="/read">Read</NavLink>
                <NavLink href="/market">Marketplace</NavLink>
                <NavLink href="/creators">Writers</NavLink>
                <NavLink href="/demo">Agent Demo</NavLink>
                <NavLink href="/docs">Docs</NavLink>
              </div>
              <WalletButton />
            </nav>
          </header>

          <main className="flex-grow">{children}</main>

          <footer className="border-t border-outline-variant bg-surface-container-low">
            <div className="mx-auto flex max-w-max-width flex-col items-center justify-between gap-stack-md px-margin-mobile py-stack-lg md:flex-row md:px-margin-desktop">
              <div className="label-caps text-on-surface">LINEPAY CITE</div>
              <div className="font-body-sm text-body-sm text-on-surface-variant">
                x402 · Circle Gateway · USDC on Arc · Lepton Hackathon
              </div>
              <div className="flex gap-gutter">
                <Link className="font-body-sm text-body-sm text-on-surface-variant hover:text-primary" href="/docs">Docs</Link>
                <Link className="font-body-sm text-body-sm text-on-surface-variant hover:text-primary" href="/market">Marketplace</Link>
                <Link className="font-body-sm text-body-sm text-on-surface-variant hover:text-primary" href="/read">Read</Link>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="font-body-md text-body-md text-surface transition-colors hover:text-primary-fixed-dim"
    >
      {children}
    </Link>
  );
}
