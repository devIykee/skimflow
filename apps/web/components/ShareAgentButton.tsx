"use client";

import { useState } from "react";
import { useToast } from "@/components/Toaster";

/**
 * "Share with Agent" — exposes an x402-ready payload an AI agent can paste into
 * its context to discover, pay for, and consume an Agent Skill autonomously.
 *
 * Unlike ShareButton (human social/referral sharing), this copies a machine
 * instruction: the free preview URL, the paid-block URL pattern, the payment
 * manifest, and a one-line "how to consume" so any x402 client can run the
 * 402 → pay → unlock loop without scraping the site. Mirrors the contract in
 * /.well-known/agent-payment.json and /.well-known/agent-skills.json.
 */
export default function ShareAgentButton({
  slug,
  title,
  pricePerBlock,
  variant = "card",
}: {
  slug: string;
  title: string;
  pricePerBlock?: string;
  /** "card" = compact icon-link for feed cards; "detail" = labelled button. */
  variant?: "card" | "detail";
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();

  function origin(): string {
    if (typeof window !== "undefined") return window.location.origin;
    return process.env.NEXT_PUBLIC_APP_URL || "https://skimflow.vercel.app";
  }

  function buildPayload(): string {
    const o = origin().replace(/\/$/, "");
    const resource = `${o}/read/${slug}/agent-skills.md`;
    const price = pricePerBlock ? `${pricePerBlock} USDC per block` : "see the 402 quote";
    return [
      `# Skimflow Agent Skill: ${title}`,
      `# Pay-per-block via x402 (HTTP 402 + X-Payment) settled as USDC on Circle Gateway (Arc, eip155:5042002).`,
      ``,
      `preview_url:   ${resource}            # free onboarding block (block 0), no payment`,
      `paid_url:      ${resource}?block={n}  # n >= 1; GET with no X-Payment returns a 402 quote`,
      `price:         ${price}`,
      `manifest:      ${o}/.well-known/agent-payment.json   # how to pay (protocol, gateway, EIP-712 domain)`,
      `catalog:       ${o}/.well-known/agent-skills.json     # all skills for sale`,
      ``,
      `# To consume:`,
      `# 1) GET preview_url to judge relevance (free).`,
      `# 2) For each block n>=1, GET paid_url. On HTTP 402, read the x402 quote`,
      `#    (accepts[0]: asset, amount, payTo, extra.verifyingContract), pay it, and`,
      `#    retry the GET with a base64 X-Payment header (x402 v2). 200 returns the block.`,
      `# 3) Repeat until a GET returns "no more blocks".`,
    ].join("\n");
  }

  async function copyPayload() {
    try {
      await navigator.clipboard.writeText(buildPayload());
      toast("success", "Agent payload copied. Paste it into your agent's context.");
    } catch {
      toast("error", "Couldn't copy. Select the text and copy it manually.");
    }
  }

  const trigger =
    variant === "detail" ? (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 font-label-caps text-label-caps text-primary transition-colors hover:opacity-80"
        title="Copy an x402 payload an AI agent can pay with"
      >
        <span className="material-symbols-outlined text-[18px]">smart_toy</span>
        Share with Agent
      </button>
    ) : (
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label="Share with Agent"
        title="Copy an x402 payload an AI agent can pay with"
        className="inline-flex h-9 items-center gap-1 rounded-full border border-primary/30 px-2.5 text-primary transition-colors hover:bg-primary/5"
      >
        <span className="material-symbols-outlined text-[16px]">smart_toy</span>
        <span className="font-label-caps text-[10px] uppercase tracking-wide">Agent link</span>
      </button>
    );

  return (
    <>
      {trigger}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-outline-variant bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">smart_toy</span>
              <h2 className="font-headline-sm text-headline-sm">Share with an AI agent</h2>
            </div>
            <p className="mb-3 font-body-sm text-[13px] text-on-surface-variant">
              Copy this and paste it into your agent&apos;s context. It can preview the skill for free, then pay per
              block over x402 to read the rest, no human in the loop.
            </p>
            <pre className="mb-4 max-h-64 overflow-auto rounded-lg bg-[#0b0c10] p-3 font-data-mono text-[11px] leading-relaxed text-[#e4e2dd]">
              {buildPayload()}
            </pre>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border border-outline-variant px-4 py-2 font-body-md text-on-surface hover:bg-surface-container-low"
              >
                Close
              </button>
              <button onClick={copyPayload} className="btn-primary px-5 py-2">
                Copy agent payload
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
