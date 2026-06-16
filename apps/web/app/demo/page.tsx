"use client";

import { useEffect, useState } from "react";

interface Step { phase: string; thought: string; t: number }
interface Citation { title: string; creator: string; lineStart: number; lineEnd: number; amountDisplay: string; txHash: string }
interface Result {
  brain: string; modelLabel?: string; mode: string; steps: Step[]; citations: Citation[];
  answer: string; spentDisplay: string; remainingDisplay: string;
}

// Material Symbols icon per phase (mirrors the Stitch timeline).
const PHASE_ICON: Record<string, string> = {
  plan: "explore", discover: "search", preview: "visibility", evaluate: "balance",
  guardian: "gpp_good", pay: "payments", skip: "block", extract: "description",
  synthesize: "extension", done: "verified",
};
const PHASE_LABEL: Record<string, string> = {
  plan: "PLAN", discover: "DISCOVER", preview: "PREVIEW", evaluate: "EVALUATE",
  guardian: "GUARDIAN", pay: "PAY", skip: "SKIP", extract: "EXTRACT",
  synthesize: "SYNTHESIZE", done: "DONE",
};

export default function DemoPage() {
  const [query, setQuery] = useState("How do nanopayments change online writing?");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [shown, setShown] = useState(0);
  const [feed, setFeed] = useState<any[]>([]);

  // Reveal reasoning steps one at a time for a live feel.
  useEffect(() => {
    if (!result || shown >= result.steps.length) return;
    const id = setTimeout(() => setShown((s) => s + 1), 380);
    return () => clearTimeout(id);
  }, [result, shown]);

  // Poll the live transaction feed.
  useEffect(() => {
    const load = () => fetch("/api/feed?limit=10").then((r) => r.json()).then((d) => setFeed(d.payments ?? []));
    load();
    const id = setInterval(load, 2500);
    return () => clearInterval(id);
  }, []);

  async function run() {
    setRunning(true); setResult(null); setShown(0);
    try {
      const res = await fetch("/api/research", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      setResult(await res.json());
    } finally {
      setRunning(false);
    }
  }

  const done = result && shown >= result.steps.length;

  return (
    <div className="mx-auto max-w-max-width px-margin-mobile py-stack-lg md:px-margin-desktop">
      <div className="flex flex-col gap-gutter md:flex-row">
        {/* Main column */}
        <div className="w-full space-y-stack-lg md:w-3/4">
          {/* Query input */}
          <section className="card">
            <h1 className="mb-stack-md font-display-lg text-display-lg-mobile text-on-surface md:text-display-lg">
              Cite-Aware Agent
            </h1>
            <div className="group relative">
              <textarea
                className="min-h-[120px] w-full rounded-lg border border-outline-variant bg-background p-stack-md font-body-lg text-body-lg transition-all focus:border-primary focus:outline-none"
                placeholder="What are the macro-economic implications of USDC on Arc for creator economies? …or 'continue reading The Clockwork Archive'"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="absolute bottom-4 right-4">
                <button className="btn-primary rounded-full px-stack-lg py-stack-sm" onClick={run} disabled={running}>
                  <span className="material-symbols-outlined text-[20px]">bolt</span>
                  {running ? "Running…" : "Run Agent"}
                </button>
              </div>
            </div>
          </section>

          {/* Chain-of-thought timeline */}
          {result && (
            <section className="relative space-y-stack-md">
              <div className="absolute left-6 top-10 bottom-4 -z-10 w-px bg-outline-variant" />
              <div className="ml-14 flex items-center gap-2">
                <h3 className="label-caps">Agent reasoning path</h3>
                <span className="pill">{result.modelLabel ?? (result.brain === "llm" ? "LLM" : "heuristic")} · {result.mode}</span>
              </div>
              {result.steps.slice(0, shown).map((s, i) => {
                const isPay = s.phase === "pay";
                const isDone = s.phase === "done";
                const accent = isPay || isDone;
                return (
                  <div key={i} className="ml-2 flex items-start gap-6">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${accent ? "bg-secondary-container text-on-secondary-container" : "border border-on-surface/10 bg-surface-container-high text-on-surface"} ${isPay ? "animate-pulse" : ""}`}>
                      <span className="material-symbols-outlined text-[18px]" style={accent ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                        {PHASE_ICON[s.phase] ?? "circle"}
                      </span>
                    </div>
                    <div className="flex flex-col pt-1">
                      <span className={`font-label-caps text-label-caps ${accent ? "text-secondary" : s.phase === "plan" ? "text-primary" : "text-on-surface"}`}>
                        PHASE {String(i + 1).padStart(2, "0")}: {PHASE_LABEL[s.phase] ?? s.phase.toUpperCase()}
                      </span>
                      <p className={`font-body-sm text-body-sm ${accent ? "text-secondary" : "text-on-surface-variant"}`}>{s.thought}</p>
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {/* Answer + citations */}
          {done && (
            <article className="card space-y-stack-md">
              <div className="flex items-center gap-2 text-outline">
                <span className="material-symbols-outlined text-[16px]">verified</span>
                <span className="label-caps">Verified agent response</span>
              </div>
              <p className="whitespace-pre-wrap font-body-lg text-body-lg leading-relaxed text-on-surface">
                {result.answer}
              </p>
              <div className="space-y-base border-t border-outline-variant pt-stack-md">
                <h4 className="label-caps">Paid sources</h4>
                <ul className="space-y-base">
                  {result.citations.map((c, i) => (
                    <li key={i} className="group flex items-center justify-between rounded p-2 text-body-sm transition-colors hover:bg-surface-container-low">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-primary">[{i + 1}]</span>
                        <span className="font-medium">{c.title}</span>
                        <span className="italic text-on-surface-variant">by @{c.creator}</span>
                        <span className="font-data-mono text-[11px] text-outline">L{c.lineStart}–{c.lineEnd}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-secondary-container px-2 py-0.5 text-[10px] font-bold text-on-secondary-container">{c.amountDisplay}</span>
                        <span className="code-chip text-[10px]">{c.txHash.slice(0, 8)}…</span>
                      </div>
                    </li>
                  ))}
                  {result.citations.length === 0 && (
                    <li className="font-body-sm text-on-surface-variant">No sources cleared the Guardian policy — try raising the budget.</li>
                  )}
                </ul>
                <p className="pt-2 font-body-sm text-body-sm">
                  Spent <strong className="text-primary">{result.spentDisplay}</strong> · {result.remainingDisplay} budget left.
                </p>
              </div>
            </article>
          )}
        </div>

        {/* Live payments sidebar */}
        <aside className="w-full md:w-1/4">
          <div className="sticky top-24 space-y-stack-md">
            <div className="flex items-center justify-between">
              <h3 className="label-caps">Live payments</h3>
              <div className="h-2 w-2 animate-pulse rounded-full bg-secondary" />
            </div>
            <div className="max-h-[600px] space-y-stack-sm overflow-y-auto pr-2">
              {feed.map((p) => (
                <div key={p.id} className="rounded-lg border border-on-surface/10 bg-surface-container-low p-stack-sm transition-all hover:bg-surface-container-lowest">
                  <div className="mb-1 flex items-start justify-between">
                    <span className="font-label-caps text-label-caps text-on-surface">@{p.creator_handle}</span>
                    <span className="text-[12px] font-bold text-secondary">+{p.creator_amount} µUSDC</span>
                  </div>
                  <p className="mb-2 truncate font-body-sm text-[12px] text-on-surface-variant">{p.title}</p>
                  <div className="flex items-center gap-1.5 font-data-mono text-[10px] text-outline">
                    <span title={p.payer_kind === "human" ? "human reader" : "AI agent"}>{p.payer_kind === "human" ? "👤" : "🤖"}</span>
                    <span className="material-symbols-outlined text-[12px]">segment</span>
                    <span>L{p.line_start}-{p.line_end}</span>
                    <span className="mx-1">•</span>
                    <span>{p.tx_hash.slice(0, 6)}…{p.tx_hash.slice(-3)}</span>
                  </div>
                </div>
              ))}
              {feed.length === 0 && <p className="font-body-sm text-body-sm text-on-surface-variant">No payments yet — run the agent.</p>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
