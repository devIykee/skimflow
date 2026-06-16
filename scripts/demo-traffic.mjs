#!/usr/bin/env node
/**
 * Generates realistic demo traction against a running server: a mix of human
 * reader payments and autonomous agent runs across the catalog, so the home
 * stats bar, creator dashboards, and live feed are populated for judges.
 *
 *   node scripts/demo-traffic.mjs
 *   APP_BASE_URL=https://… node scripts/demo-traffic.mjs
 */
const BASE = process.env.APP_BASE_URL || "http://localhost:3000";

const QUERIES = [
  "How do nanopayments change the economics of online writing?",
  "How do x402 paywalls and revenue splits work on Arc?",
  "What makes per-line pricing better than subscriptions?",
  "continue reading The Clockwork Archive",
];

async function getJson(path, opts) {
  const res = await fetch(`${BASE}${path}`, opts);
  return res.json();
}

async function humanReads(item) {
  // A human unlocks two chunks of a piece (lines 4-13, 14-23 where available).
  const ranges = [
    [4, Math.min(item.line_count, 13)],
    [14, Math.min(item.line_count, 23)],
  ];
  for (const [lineStart, lineEnd] of ranges) {
    if (lineEnd < lineStart) continue;
    const d = await getJson(`/api/reader/${item.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineStart, lineEnd }),
    });
    if (d.paid) console.log(`  👤 human paid ${d.amountDisplay} → @${item.creator_handle} (L${lineStart}-${lineEnd})`);
  }
}

async function agentRuns() {
  for (const q of QUERIES) {
    const d = await getJson(`/api/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q }),
    });
    if (d.citations) console.log(`  🤖 agent "${q.slice(0, 40)}…" → ${d.citations.length} paid sources, spent ${d.spentDisplay}`);
  }
}

async function main() {
  console.log(`Generating demo traffic against ${BASE} …`);
  const { items } = await getJson("/api/catalog");
  if (!items?.length) {
    console.error("No content — run `npm run seed` first.");
    process.exit(1);
  }
  // Humans read the first few articles.
  for (const item of items.filter((i) => i.kind === "article").slice(0, 4)) {
    await humanReads(item);
  }
  // Agents do several research runs.
  await agentRuns();

  const s = await getJson("/api/stats");
  console.log(`\n✅ Traction: ${s.volumeDisplay} volume · ${s.payments} payments (👤 ${s.humanPayments} / 🤖 ${s.agentPayments}) · ${s.linesSold} lines · ${s.toCreatorsDisplay} to creators`);
}

main().catch((e) => {
  console.error("demo-traffic failed:", e.message);
  console.error("Is the server running + seeded?  npm run dev  then  npm run seed");
  process.exit(1);
});
