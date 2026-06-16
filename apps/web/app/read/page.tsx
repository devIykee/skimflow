"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface CatalogItem {
  id: string; kind: string; title: string; summary: string; tags: string;
  line_count: number; price_per_line: string; creator_handle: string; verified: boolean;
}

function usd(baseUnits: string | number) {
  return `$${(Number(baseUnits) / 1_000_000).toFixed(6)}`;
}

function badge(kind: string) {
  if (kind === "novel_chapter") return "novel";
  return kind; // article | agent-skill | prompt-template | knowledge-base
}

export default function ReadPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);

  useEffect(() => {
    fetch("/api/catalog").then((r) => r.json()).then((d) => setItems(d.items ?? []));
  }, []);

  return (
    <div className="mx-auto max-w-max-width px-margin-mobile py-stack-lg md:px-margin-desktop">
      <header className="mb-12">
        <h1 className="mb-2 font-display-lg text-display-lg-mobile md:text-display-lg">Read &amp; Pay Per Line</h1>
        <p className="max-w-2xl font-body-lg text-body-lg text-on-surface-variant">
          Read the free preview, then unlock the rest one payment at a time. Every line you buy pays
          the creator directly — settled as USDC on Arc through Circle Gateway.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-3">
        {items.map((c) => (
          <Link key={c.id} href={`/content/${c.id}`} className="card flex flex-col text-left transition-all hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-2 flex items-center gap-2">
              <span className="pill">{badge(c.kind)}</span>
              {c.verified && (
                <span className="flex items-center gap-1 font-label-caps text-label-caps text-secondary">
                  <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>verified
                </span>
              )}
            </div>
            <h3 className="mb-2 font-headline-sm text-headline-sm leading-tight">{c.title}</h3>
            <p className="mb-4 flex-grow font-body-sm text-body-sm text-on-surface-variant">{c.summary}</p>
            <div className="flex items-center justify-between font-data-mono text-[12px] text-outline">
              <span>@{c.creator_handle}</span>
              <span>{usd(c.price_per_line)}/line · {c.line_count} lines</span>
            </div>
          </Link>
        ))}
        {items.length === 0 && <p className="font-body-md text-on-surface-variant">No content yet — seed the demo or publish from the Creator Portal.</p>}
      </div>
    </div>
  );
}
