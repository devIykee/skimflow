#!/usr/bin/env node
/**
 * Buyer-agent CLI — runs the full agent-skills 402 → pay → unlock flow against a
 * running Skimflow server and prints the reasoning/payment trace.
 *
 *   npm run agent -- --url http://localhost:3000 --slug my-skill-abc12 --simulate
 *   npm run agent -- --slug my-skill-abc12            # live (needs BUYER_PRIVATE_KEY)
 */
import { runAgentSkills } from "./agent-skills-client.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const baseUrl = flag("url") ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
  const slug = flag("slug");
  const simulate = has("simulate") || (process.env.PAYMENTS_MODE ?? "simulate").toLowerCase() !== "live";

  if (!slug) {
    console.error("Usage: npm run agent -- --url <baseUrl> --slug <content-slug> [--simulate]");
    process.exit(1);
  }

  console.log(`\n🤖 Skimflow buyer agent (agent-skills flow)`);
  console.log(`   server: ${baseUrl}`);
  console.log(`   slug:   ${slug}`);
  console.log(`   mode:   ${simulate ? "simulate" : "live"}\n`);

  const result = await runAgentSkills({ baseUrl, slug, simulate });

  console.log("🔎 [discover] /.well-known/agent-payment.json ->", result.discovery ? "found" : "not found");
  if (result.discovery) {
    console.log(`   protocol: ${result.discovery.payment_protocol} · gateway: ${result.discovery.gateway_address}`);
  }
  console.log(`👀 [block 0] free onboarding (${result.block0.length} chars)\n`);

  for (const b of result.blocks) {
    if (b.status === "paid") {
      console.log(`💸 [block ${b.blockIndex}] paid ${b.cost} USDC (token ${String(b.token).slice(0, 16)}…) -> ${b.chars} chars · rate-remaining ${b.rateRemaining}`);
    } else if (b.status === "402") {
      console.log(`⚠️  [block ${b.blockIndex}] payment not accepted (token ${String(b.token).slice(0, 16)}…)`);
    } else {
      console.log(`✅ [block ${b.blockIndex}] no more blocks — extraction complete`);
    }
  }

  console.log(`\n💰 spent ${result.spent} USDC across ${result.blocks.filter((b) => b.status === "paid").length} block(s).\n`);
}

main().catch((e) => {
  console.error("agent error:", e?.message ?? e);
  process.exit(1);
});
