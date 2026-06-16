import {
  checkPolicy,
  DEFAULT_POLICY,
  formatUsdc,
  verifiedBonus,
  type GuardianPolicy,
  type PaymentRequirement,
} from "@linepay/sdk";
import { X402Client } from "./x402-client.js";

// ── Catalog item shape (from /api/catalog) ───────────────────────────────────
interface CatalogItem {
  id: string;
  kind: "article" | "novel_chapter";
  title: string;
  summary: string;
  tags: string;
  line_count: number;
  price_per_line: string;
  series: string | null;
  chapter_no: number | null;
  creator_handle: string;
  verified: boolean;
}

// ── A single visible step in the agent's reasoning trace ─────────────────────
export interface AgentStep {
  t: number;
  phase: "plan" | "discover" | "preview" | "evaluate" | "guardian" | "pay" | "skip" | "extract" | "synthesize" | "done";
  thought: string;
  data?: Record<string, unknown>;
}

export interface Citation {
  contentId: string;
  title: string;
  creator: string;
  lineStart: number;
  lineEnd: number;
  amountDisplay: string;
  txHash: string;
  excerpt: string;
}

export interface ResearchResult {
  query: string;
  mode: "continue-novel" | "research";
  brain: "llm" | "heuristic";
  /** Human-readable provider + model, e.g. "Groq · llama-3.3-70b-versatile". */
  modelLabel: string;
  steps: AgentStep[];
  citations: Citation[];
  answer: string;
  spentBaseUnits: string;
  spentDisplay: string;
  remainingDisplay: string;
}

export interface RunOptions {
  baseUrl?: string;
  policy?: GuardianPolicy;
  maxCandidates?: number;
  /** Lines to buy per chosen source. */
  buyLines?: number;
}

// ── LLM lazy loader (provider-agnostic via LangChain) ────────────────────────
// Picks a provider by available API key, or by AGENT_PROVIDER override:
//   - Groq      (free, fast)  → GROQ_API_KEY      [@langchain/groq]
//   - Anthropic (Claude)      → ANTHROPIC_API_KEY [@langchain/anthropic]
//   - none → null → deterministic heuristic brain (demo still runs offline)
async function getModel(): Promise<{ model: any; label: string } | null> {
  const provider = (process.env.AGENT_PROVIDER ?? "").toLowerCase();
  const hasGroq = !!process.env.GROQ_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  const useGroq = provider === "groq" || (provider === "" && hasGroq);
  const useAnthropic = provider === "anthropic" || (provider === "" && !hasGroq && hasAnthropic);

  if (useGroq && hasGroq) {
    const { ChatGroq } = await import("@langchain/groq");
    const model = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
    return {
      model: new ChatGroq({ model, maxTokens: 1500, temperature: 0.3 }),
      label: `Groq · ${model}`,
    };
  }
  if (useAnthropic && hasAnthropic) {
    const { ChatAnthropic } = await import("@langchain/anthropic");
    const model = process.env.AGENT_MODEL ?? "claude-opus-4-8";
    // Opus 4.8 uses adaptive thinking; do not set temperature (rejected).
    return { model: new ChatAnthropic({ model, maxTokens: 1500 }), label: `Claude · ${model}` };
  }
  return null;
}

function extractJson<T>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

// ── Heuristic relevance (used when no ANTHROPIC_API_KEY) ──────────────────────
function keywordScore(query: string, item: CatalogItem): number {
  const q = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const hay = `${item.title} ${item.summary} ${item.tags}`.toLowerCase();
  if (q.length === 0) return 0;
  const hits = q.filter((w) => hay.includes(w)).length;
  return Math.min(1, hits / q.length) + verifiedBonus(item.verified);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point: autonomous research / continue-reading run.
// ─────────────────────────────────────────────────────────────────────────────
export async function runResearch(query: string, opts: RunOptions = {}): Promise<ResearchResult> {
  const baseUrl = opts.baseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
  const policy = opts.policy ?? DEFAULT_POLICY;
  const buyLines = opts.buyLines ?? 40;
  const maxCandidates = opts.maxCandidates ?? 4;

  const client = new X402Client(baseUrl);
  const llm = await getModel();
  const model = llm?.model ?? null;
  const brain: "llm" | "heuristic" = model ? "llm" : "heuristic";
  const modelLabel = llm?.label ?? "heuristic (no API key)";

  const steps: AgentStep[] = [];
  const citations: Citation[] = [];
  const log = (s: Omit<AgentStep, "t">) => steps.push({ t: Date.now(), ...s });

  const isContinue = /continue|next chapter|keep reading|read more/i.test(query);
  const mode = isContinue ? "continue-novel" : "research";

  log({
    phase: "plan",
    thought:
      `Goal: ${mode === "continue-novel" ? "continue a light novel" : "answer a research query"}. ` +
      `Budget ${formatUsdc(policy.budgetBaseUnits)}, max ${formatUsdc(policy.maxPricePerLine)}/line, ` +
      `verified-only=${policy.requireVerified}. Reasoning with ${modelLabel}. I will discover paywalled sources, ` +
      `read free previews, decide what's worth paying for, clear each payment through Guardian, then pay per line via x402+Gateway.`,
  });

  // 1) Discover ----------------------------------------------------------------
  const catRes = await fetch(`${baseUrl}/api/catalog`);
  const { items } = (await catRes.json()) as { items: CatalogItem[] };

  let candidates = items.slice();
  if (mode === "continue-novel") {
    // Match a series by title/tag keywords, then order by chapter number.
    const ranked = candidates
      .filter((i) => i.kind === "novel_chapter")
      .map((i) => ({ i, score: keywordScore(query, i) }))
      .sort((a, b) => b.score - a.score);
    const topSeries = ranked[0]?.i.series ?? ranked[0]?.i.title;
    candidates = candidates
      .filter((i) => i.kind === "novel_chapter" && (i.series === topSeries || i.title === topSeries))
      .sort((a, b) => (a.chapter_no ?? 0) - (b.chapter_no ?? 0));
    log({ phase: "discover", thought: `Found series "${topSeries}" with ${candidates.length} chapter(s).`, data: { series: topSeries } });
  } else {
    candidates = candidates
      .map((i) => ({ i, score: keywordScore(query, i) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCandidates)
      .map((x) => x.i);
    log({
      phase: "discover",
      thought: `Discovered ${candidates.length} candidate source(s): ${candidates.map((c) => `"${c.title}" @${c.creator_handle}`).join("; ")}.`,
      data: { candidates: candidates.map((c) => c.id) },
    });
  }

  // 2..6) For each candidate: preview -> evaluate -> guardian -> pay -> extract
  let spent = 0n;
  const collected: { item: CatalogItem; text: string }[] = [];

  for (const item of candidates.slice(0, maxCandidates)) {
    const remaining = BigInt(policy.budgetBaseUnits) - spent;
    if (remaining <= 0n) {
      log({ phase: "skip", thought: `Budget exhausted (${formatUsdc(spent)} spent). Stopping discovery.` });
      break;
    }

    // Preview (free)
    const prev = await client.preview(item.id, 3);
    log({
      phase: "preview",
      thought: `Previewed "${item.title}" by @${item.creator_handle} (free lines): ${prev.text.slice(0, 140).replace(/\n/g, " ")}…`,
      data: { contentId: item.id },
    });

    // Determine the range to buy.
    const lineEnd = Math.min(item.line_count, 3 + buyLines);
    const lineStart = 4; // start right after the free preview

    // Quote (gets the x402 requirement so Guardian can reason over real price).
    const quote = await client.quote(item.id, lineStart, lineEnd);
    if (!quote) {
      log({ phase: "skip", thought: `No paid quote returned for "${item.title}" (range may be free). Reading free portion only.` });
      collected.push({ item, text: prev.text });
      continue;
    }

    // Evaluate worth (LLM decision or heuristic).
    const decision = await evaluateWorth(model, query, item, prev.text, quote, remaining);
    log({
      phase: "evaluate",
      thought: `Relevance ${(decision.relevance * 100).toFixed(0)}% — ${decision.reason} ` +
        `Cost ${formatUsdc(quote.amount)} for ${quote.extra.lineCount} lines @ ${formatUsdc(quote.extra.pricePerLine)}/line.`,
      data: { relevance: decision.relevance, worth: decision.worthPaying, amount: quote.amount },
    });

    if (!decision.worthPaying) {
      log({ phase: "skip", thought: `Decided NOT to pay for "${item.title}": ${decision.reason}` });
      continue;
    }

    // Guardian gate (hard enforcement, independent of the LLM).
    const verdict = checkPolicy(policy, quote, spent);
    log({
      phase: "guardian",
      thought: `Guardian: ${verdict.allowed ? "APPROVED" : "BLOCKED"} — ${verdict.reason}. ` +
        `Remaining after: ${formatUsdc(verdict.remainingAfter)}.`,
      data: { allowed: verdict.allowed, remainingAfter: verdict.remainingAfter },
    });
    if (!verdict.allowed) {
      log({ phase: "skip", thought: `Guardian blocked the purchase of "${item.title}". Skipping.` });
      continue;
    }

    // Pay via x402 + Gateway, then extract.
    try {
      const paid = await client.payAndRead(item.id, lineStart, lineEnd);
      spent += BigInt(paid.requirement.amount);
      log({
        phase: "pay",
        thought: `Paid ${formatUsdc(paid.requirement.amount)} to @${item.creator_handle} via Circle Gateway on Arc ` +
          `(tx ${paid.receipt.txHash.slice(0, 14)}…${paid.receipt.simulated ? ", simulated" : ""}). Lines ${lineStart}-${lineEnd} unlocked.`,
        data: { txHash: paid.receipt.txHash, amount: paid.requirement.amount, batchId: paid.receipt.batchId },
      });
      const excerpt = (prev.text + "\n" + paid.text).trim();
      collected.push({ item, text: excerpt });
      citations.push({
        contentId: item.id,
        title: item.title,
        creator: item.creator_handle,
        lineStart,
        lineEnd,
        amountDisplay: formatUsdc(paid.requirement.amount),
        txHash: paid.receipt.txHash,
        excerpt: paid.text.slice(0, 400),
      });
      log({ phase: "extract", thought: `Extracted ${paid.text.length} chars from "${item.title}" and cited the source.` });
    } catch (e: any) {
      log({ phase: "skip", thought: `Payment/extraction failed for "${item.title}": ${String(e?.message ?? e)}` });
    }
  }

  // 7) Synthesize cited answer / continued reading -----------------------------
  const answer = await synthesize(model, query, mode, collected);
  log({ phase: "synthesize", thought: `Synthesized ${mode === "continue-novel" ? "continued reading" : "cited answer"} from ${citations.length} paid source(s).` });

  const remainingDisplay = formatUsdc(BigInt(policy.budgetBaseUnits) - spent);
  log({ phase: "done", thought: `Done. Spent ${formatUsdc(spent)} of ${formatUsdc(policy.budgetBaseUnits)}; ${remainingDisplay} left.` });

  return {
    query,
    mode,
    brain,
    modelLabel,
    steps,
    citations,
    answer,
    spentBaseUnits: spent.toString(),
    spentDisplay: formatUsdc(spent),
    remainingDisplay,
  };
}

// ── LLM / heuristic: is a source worth paying for? ───────────────────────────
async function evaluateWorth(
  model: any,
  query: string,
  item: CatalogItem,
  preview: string,
  quote: PaymentRequirement,
  remaining: bigint
): Promise<{ worthPaying: boolean; relevance: number; reason: string }> {
  if (!model) {
    const score = Math.min(1, keywordScore(query, item));
    const affordable = BigInt(quote.amount) <= remaining;
    return {
      worthPaying: score >= 0.34 && affordable,
      relevance: score,
      reason:
        (score >= 0.34 ? "keyword relevance clears threshold" : "low keyword overlap") +
        (affordable ? "" : "; over remaining budget"),
    };
  }
  const { HumanMessage, SystemMessage } = await import("@langchain/core/messages");
  const prompt = [
    new SystemMessage(
      "You are a frugal autonomous reading agent. Decide whether paying a micro-amount to read a paywalled source is worth it for the user's goal. " +
        "Return ONLY JSON: {\"worthPaying\": boolean, \"relevance\": number (0-1), \"reason\": string}."
    ),
    new HumanMessage(
      `User goal: ${query}\n\nSource: "${item.title}" by @${item.creator_handle} (verified=${item.verified})\n` +
        `Summary: ${item.summary}\nTags: ${item.tags}\nFree preview:\n${preview}\n\n` +
        `Price: ${formatUsdc(quote.amount)} for ${quote.extra.lineCount} lines. Remaining budget: ${formatUsdc(remaining)}.`
    ),
  ];
  try {
    const res = await model.invoke(prompt);
    const txt = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
    const parsed = extractJson<{ worthPaying: boolean; relevance: number; reason: string }>(txt);
    if (parsed) return parsed;
  } catch {
    /* fall through to heuristic */
  }
  const score = Math.min(1, keywordScore(query, item));
  return { worthPaying: score >= 0.34, relevance: score, reason: "fallback heuristic (LLM unavailable)" };
}

// ── LLM / heuristic: produce the final cited answer ──────────────────────────
async function synthesize(
  model: any,
  query: string,
  mode: "continue-novel" | "research",
  collected: { item: CatalogItem; text: string }[]
): Promise<string> {
  if (collected.length === 0) {
    return "No sources were worth paying for under the current Guardian policy. Try raising the budget or per-line cap.";
  }
  if (!model) {
    if (mode === "continue-novel") {
      return collected.map((c) => `— ${c.item.title} —\n${c.text}`).join("\n\n");
    }
    return (
      `Summary for: ${query}\n\n` +
      collected
        .map((c, i) => `[${i + 1}] ${c.item.title} (@${c.item.creator_handle}): ${c.text.slice(0, 280).replace(/\n/g, " ")}…`)
        .join("\n\n")
    );
  }
  const { HumanMessage, SystemMessage } = await import("@langchain/core/messages");
  const sources = collected
    .map((c, i) => `[${i + 1}] "${c.item.title}" by @${c.item.creator_handle}:\n${c.text}`)
    .join("\n\n");
  const sys =
    mode === "continue-novel"
      ? "You are a reading companion. Stitch the paid novel excerpts into a smooth continued-reading experience. Keep the prose; add brief connective tissue only if needed."
      : "You are a research assistant. Write a concise, well-structured answer to the user's query grounded ONLY in the provided paid sources. Cite sources inline as [1], [2], etc.";
  const res = await model.invoke([
    new SystemMessage(sys),
    new HumanMessage(`User goal: ${query}\n\nPaid sources:\n${sources}`),
  ]);
  return typeof res.content === "string" ? res.content : JSON.stringify(res.content);
}
