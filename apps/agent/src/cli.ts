#!/usr/bin/env node
/**
 * Buyer-agent CLI. Runs an autonomous research / continue-reading session
 * against a running LinePay Cite server and prints the full reasoning trace.
 *
 *   npm run agent -- "best practices for nanopayments on Arc"
 *   npm run agent -- "continue reading The Clockwork Archive"
 */
import { runResearch } from "./agent.js";
import { DEFAULT_POLICY } from "@linepay/sdk";

async function main() {
  const query = process.argv.slice(2).join(" ").trim() ||
    "How do nanopayments change the economics of online writing?";
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";

  console.log(`\n🤖 LinePay Cite buyer agent`);
  console.log(`   query: ${query}`);
  console.log(`   server: ${baseUrl}\n`);

  const result = await runResearch(query, { baseUrl, policy: DEFAULT_POLICY });

  for (const s of result.steps) {
    const icon =
      { plan: "🧭", discover: "🔎", preview: "👀", evaluate: "⚖️", guardian: "🛡️", pay: "💸", skip: "⏭️", extract: "📄", synthesize: "🧩", done: "✅" }[s.phase] ?? "•";
    console.log(`${icon} [${s.phase}] ${s.thought}`);
  }

  console.log(`\n────────────────────────── ANSWER ──────────────────────────\n`);
  console.log(result.answer);
  console.log(`\n────────────────────────── CITATIONS ───────────────────────`);
  for (const c of result.citations) {
    console.log(`  • "${c.title}" @${c.creator} lines ${c.lineStart}-${c.lineEnd} — paid ${c.amountDisplay} (tx ${c.txHash.slice(0, 12)}…)`);
  }
  console.log(`\n💰 spent ${result.spentDisplay} · reasoning: ${result.modelLabel} · ${result.remainingDisplay} budget left\n`);
}

main().catch((e) => {
  console.error("agent error:", e);
  process.exit(1);
});
