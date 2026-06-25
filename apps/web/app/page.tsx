import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import StatsBar from "@/components/StatsBar";
import { currentSession } from "@/lib/session";

// Authenticated visitors don't need the marketing page — send them straight to
// their feed. Server-side redirect (no client flash of the landing page).
export const dynamic = "force-dynamic";

// Home keeps the full tagline (set in layout's default title) + a canonical URL.
export const metadata: Metadata = { alternates: { canonical: "/" } };

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://skimflow.vercel.app").replace(/\/$/, "");
// WebSite schema with a SearchAction so Google can show a sitelinks search box.
const WEBSITE_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Skimflow",
  url: SITE_URL,
  description:
    "Pay-per-block reading for people and AI agents — articles, books, and picture stories in USDC on Arc.",
  potentialAction: {
    "@type": "SearchAction",
    target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/for-you?q={search_term_string}` },
    "query-input": "required name=search_term_string",
  },
};

const STEPS = [
  { code: "HTTP 402 Required", text: "A reader or agent requests a paid block and the server returns a payment-required status with a machine-readable x402 quote." },
  { code: "Guardian Check", text: "The Guardian verifies budget, max price-per-block, and verified-creator preference before any funds move." },
  { code: "Circle Gateway", text: "A gas-free USDC authorization is signed; the nanopayment is batched through the Circle Gateway." },
  { code: "Settle on Arc", text: "The transaction settles on Arc as USDC in under half a second. A receipt proves payment and unlocks the block." },
];

const FEATURES = [
  { icon: "edit_note", title: "Per-block pricing", body: "Monetize at the granular level. Readers and agents pay micro-amounts for exactly the blocks they consume, from $0.000001 up." },
  { icon: "smart_toy", title: "Agents welcome", body: "Built for the machine age. Autonomous agents discover your work and pay the required nanopayment instantly to cite it." },
  { icon: "payments", title: "Automatic 80/12/5/3 splits", body: "Revenue is distributed in real time: 80% to you, 12% to the platform, 5% to a referrer, and 3% to a reserve. With no referrer the 5% folds into the reserve. Transparent and on-chain." },
];

export default async function Home() {
  const session = await currentSession();
  if (session?.user?.id) redirect("/for-you");

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_LD) }} />
      {/* Hero */}
      <section className="px-margin-mobile py-24 text-center md:px-margin-desktop md:py-32">
        <div className="mx-auto max-w-4xl space-y-stack-lg">
          <h1 className="font-display-lg text-display-lg-mobile tracking-tight md:text-display-lg">
            Get paid every time someone reads a block of your story.
          </h1>
          <p className="mx-auto max-w-2xl font-body-lg text-body-lg text-on-surface-variant">
            Skimflow lets writers earn USDC every time someone reads a block of their story, with instant settlement.
          </p>
          <div className="flex flex-col items-center justify-center gap-gutter pt-stack-md sm:flex-row">
            <Link href="/for-you" className="btn-primary w-full px-10 py-4 !text-body-lg editorial-shadow sm:w-auto">
              Browse the feed →
            </Link>
            <Link href="/dashboard" className="btn-outline w-full px-10 py-4 !text-body-lg sm:w-auto">
              Start publishing →
            </Link>
          </div>
          <StatsBar />
        </div>
      </section>

      {/* Features */}
      <section className="bg-surface-container-low px-margin-mobile md:px-margin-desktop">
        <div className="editorial-container py-32">
          <div className="grid grid-cols-1 gap-gutter md:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="card flex flex-col">
                <span className="material-symbols-outlined mb-stack-md text-[40px] text-primary">{f.icon}</span>
                <h3 className="mb-stack-md font-headline-sm text-headline-sm">{f.title}</h3>
                <p className="font-body-md text-body-md text-on-surface-variant">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture timeline */}
      <section className="px-margin-mobile py-32 md:px-margin-desktop">
        <div className="editorial-container paper-texture rounded-xl border border-outline-variant/30 p-stack-lg md:p-16">
          <div className="mx-auto max-w-3xl">
            <span className="mb-stack-sm block font-label-caps text-label-caps text-primary">TECHNICAL STACK</span>
            <h2 className="mb-stack-lg font-display-lg text-display-lg-mobile md:text-headline-md">
              The Architecture of a Citation
            </h2>
            <div className="space-y-stack-lg pt-stack-lg">
              {STEPS.map((s, i) => (
                <div key={s.code} className="flex items-start gap-gutter">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary font-data-mono text-on-primary">
                    {i + 1}
                  </div>
                  <div className="flex-grow">
                    <span className="mb-1 block font-data-mono text-data-mono uppercase text-primary">{s.code}</span>
                    <p className="font-body-md text-body-md text-on-surface-variant">{s.text}</p>
                  </div>
                </div>
              ))}
              <div className="flex items-start gap-gutter">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary font-data-mono text-on-primary">5</div>
                <div className="flex-grow">
                  <div className="flex items-center justify-between rounded-lg border border-on-surface/5 bg-surface-container-highest p-4">
                    <span className="font-data-mono text-data-mono text-on-surface">Earnings Update: +0.005 USDC</span>
                    <span className="material-symbols-outlined text-secondary">check_circle</span>
                  </div>
                  <p className="mt-2 font-body-md text-body-md text-on-surface-variant">
                    The writer&apos;s dashboard reflects the payment instantly. No 30-day payout cycles.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-outline-variant px-margin-mobile py-32 text-center md:px-margin-desktop">
        <div className="mx-auto max-w-2xl space-y-stack-md">
          <h2 className="font-headline-md text-headline-md">Make the smallest unit sellable.</h2>
          <p className="mb-stack-lg font-body-md text-body-md text-on-surface-variant">
            Put a block behind Skimflow and every reader (human or agent) pays you for it.
          </p>
          <div className="flex justify-center gap-gutter pt-stack-md">
            <Link href="/dashboard" className="btn-primary px-12 py-4 !text-body-lg editorial-shadow">Start Writing</Link>
            <Link href="/for-you" className="btn-outline px-12 py-4 !text-body-lg">Start Reading</Link>
          </div>
        </div>
      </section>
    </>
  );
}
