#!/usr/bin/env node
/**
 * Seeds LinePay Cite by POSTing creators + content to a running server.
 * This exercises the real /api/creators and /api/content endpoints, so the
 * seeded data lives in exactly the DB the server is using.
 *
 *   node scripts/seed.mjs            # seeds http://localhost:3000
 *   APP_BASE_URL=https://… node scripts/seed.mjs
 */
const BASE = process.env.APP_BASE_URL || "http://localhost:3000";

const creators = [
  { handle: "ada_writes", display_name: "Ada Quill", wallet: "0xADA0000000000000000000000000000000000001", verified: true },
  { handle: "satoshi_serializes", display_name: "S. Nakareader", wallet: "0x5A70000000000000000000000000000000000002", verified: true },
  { handle: "indie_mira", display_name: "Mira Lin", wallet: "0x31DE000000000000000000000000000000000003", verified: false },
  { handle: "novelist_kai", display_name: "Kai Ardent", wallet: "0xca10000000000000000000000000000000000004", verified: true },
];

const lines = (...l) => l.join("\n");

const articles = [
  {
    creatorHandle: "ada_writes", kind: "article", pricePerLine: 0.00005,
    title: "Why Nanopayments Beat Subscriptions for Writers",
    summary: "The economics of charging per line instead of per month.",
    tags: "nanopayments,economics,writing,arc",
    body: lines(
      "# Why Nanopayments Beat Subscriptions for Writers",
      "",
      "Subscriptions are a blunt instrument. A reader who wants one article",
      "must commit to a month; a writer who publishes weekly must justify a",
      "recurring charge. Most readers never convert.",
      "Nanopayments invert this. Instead of asking for $5/month, you ask for",
      "$0.00005 per line. A 400-line essay costs two cents to read in full,",
      "and the reader pays only for what they actually consume.",
      "On Arc, Circle Gateway batches these micro-charges so neither side pays",
      "gas per read. The settlement floor is a single USDC base unit —",
      "$0.000001 — which is small enough to price a single sentence.",
      "The result: long-tail writing becomes economically viable. Niche",
      "essays that would never sustain a subscription can still earn, because",
      "the unit of sale shrinks to match the unit of attention.",
      "Agents change the math again. An AI research agent reading ten sources",
      "will happily pay forty cents total if each source is relevant — far",
      "more than any of those writers would earn from ad impressions.",
      "The writer's job becomes: write something worth a line's price.",
    ),
  },
  {
    creatorHandle: "ada_writes", kind: "article", pricePerLine: 0.00008,
    title: "Designing an x402 Paywall That Agents Respect",
    summary: "Practical patterns for HTTP 402 + Circle Gateway.",
    tags: "x402,paywall,http,agents,gateway",
    body: lines(
      "# Designing an x402 Paywall That Agents Respect",
      "",
      "The x402 protocol revives HTTP's long-dormant 402 status code.",
      "A client requests a resource; the server replies 402 with a machine-",
      "readable quote describing exactly what payment unlocks it.",
      "The client pays and retries with an X-PAYMENT header.",
      "For agents, the quote is everything. It must state the asset, amount,",
      "recipient, and a nonce — enough for the agent to reason about cost",
      "before committing funds.",
      "Keep the first few lines free. Agents need a preview to judge",
      "relevance; a paywall with no teaser gets skipped, not paid.",
      "Settle through Circle Gateway so the payment is gas-free and batched.",
      "Return an X-PAYMENT-RESPONSE receipt so the agent can cite the tx.",
      "Done well, the paywall is invisible to humans and legible to machines.",
    ),
  },
  {
    creatorHandle: "satoshi_serializes", kind: "article", pricePerLine: 0.0001,
    title: "USDC on Arc: A Settlement Primer",
    summary: "How stablecoin settlement works on Circle's Arc L1.",
    tags: "usdc,arc,circle,settlement,stablecoin",
    body: lines(
      "# USDC on Arc: A Settlement Primer",
      "",
      "Arc is Circle's L1 purpose-built for stablecoin payments.",
      "USDC is the native unit of account, with six decimals of precision.",
      "Because the chain is optimized for payments, finality is fast and",
      "fees are negligible — the preconditions for nanopayments.",
      "Circle Gateway sits on top, batching signed transfer authorizations.",
      "A buyer signs an EIP-712 authorization off-chain; the facilitator",
      "aggregates many such authorizations and settles them together.",
      "This is what makes per-line pricing practical: the buyer never pays",
      "gas for an individual five-thousandth-of-a-cent transfer.",
      "For builders, the mental model is simple: quote in base units,",
      "authorize off-chain, settle in batches, reconcile from receipts.",
    ),
  },
  {
    creatorHandle: "satoshi_serializes", kind: "article", pricePerLine: 0.00006,
    title: "Revenue Splits Without Middlemen",
    summary: "On-chain 85/10/5 splits with a tiny Solidity contract.",
    tags: "revenue,split,solidity,smartcontract,arc",
    body: lines(
      "# Revenue Splits Without Middlemen",
      "",
      "Platforms historically took 30-50% and paid creators monthly.",
      "An on-chain split contract pays everyone in the same transaction.",
      "The buyer approves the contract for the line-range price.",
      "On `pay`, the contract pulls USDC and forwards 85% to the creator,",
      "10% to the platform, and 5% to whoever referred the reader.",
      "Either all three legs transfer or the whole call reverts — the",
      "creator is never left short.",
      "Settlement is instant and auditable. No invoices, no net-30, no",
      "opaque deductions. The split is the receipt.",
    ),
  },
  {
    creatorHandle: "indie_mira", kind: "article", pricePerLine: 0.00004,
    title: "An Indie Writer's First Week on Per-Line Pay",
    summary: "Field notes from selling essays by the line.",
    tags: "indie,creator,case-study,writing",
    body: lines(
      "# An Indie Writer's First Week on Per-Line Pay",
      "",
      "I published four essays and set each at $0.00004 a line.",
      "By day three, an AI research agent had bought lines from all four.",
      "It paid for exactly the sections relevant to its query and skipped",
      "the rest — which felt fairer than an all-or-nothing paywall.",
      "Human readers used the free preview, then a few paid to finish.",
      "The dashboard updated in real time; watching micro-payments land was",
      "oddly motivating.",
      "My takeaway: write tight. Every line is literally for sale, so filler",
      "is now visibly worthless.",
    ),
  },
  {
    creatorHandle: "indie_mira", kind: "article", pricePerLine: 0.00004,
    title: "Pricing Your Lines: A Quick Framework",
    summary: "How to choose a per-line price that readers and agents accept.",
    tags: "pricing,strategy,creator",
    body: lines(
      "# Pricing Your Lines: A Quick Framework",
      "",
      "Start from the whole-piece price you'd feel good about.",
      "Divide by your line count to get a per-line floor.",
      "Then check it against agent budgets: most reading agents cap around",
      "$0.0002 per line, so stay well under that to remain buyable.",
      "Verified creators can charge a small premium; agents that prefer",
      "verified sources will still clear it.",
      "Keep three free lines as a hook. Re-price anytime — the quote is",
      "generated per request, so changes take effect immediately.",
    ),
  },
  {
    creatorHandle: "satoshi_serializes", kind: "article", pricePerLine: 0.00007,
    title: "Guardian Policies for Spending Agents",
    summary: "Budget caps, price ceilings, and verified-creator preference.",
    tags: "guardian,policy,agents,safety",
    body: lines(
      "# Guardian Policies for Spending Agents",
      "",
      "An autonomous agent with a wallet needs guardrails.",
      "The simplest effective policy has three knobs: a total run budget,",
      "a maximum acceptable price per line, and a per-purchase cap.",
      "Add a verified-creator preference and an allow/block list and you",
      "have covered the majority of real spending mistakes.",
      "Crucially, the Guardian is enforced in code, not by the model.",
      "The LLM may decide a source is worth reading, but the Guardian has",
      "the final say on whether the money actually moves.",
      "This separation keeps a persuasive paywall from talking an agent",
      "into overspending.",
    ),
  },
  {
    creatorHandle: "ada_writes", kind: "article", pricePerLine: 0.00005,
    title: "Citations as a First-Class Output",
    summary: "Why paid reading produces better-cited answers.",
    tags: "citations,research,agents,provenance",
    body: lines(
      "# Citations as a First-Class Output",
      "",
      "When an agent pays to read a source, it gets a receipt with a tx hash.",
      "That receipt is provenance: proof the agent actually accessed the",
      "text it is citing, and proof the author was compensated.",
      "Compare this to scraping, where neither claim holds.",
      "Paid reading aligns incentives: writers are paid, readers get",
      "verifiable citations, and the answer carries an audit trail down to",
      "the exact line range that was purchased.",
      "Provenance stops being an afterthought and becomes the byproduct of",
      "the payment itself.",
    ),
  },
];

const novels = [
  {
    creatorHandle: "novelist_kai", kind: "novel_chapter", pricePerLine: 0.00003,
    series: "the-clockwork-archive", chapterNo: 1,
    title: "The Clockwork Archive — Chapter 1: The Ledger That Breathed",
    summary: "Vael discovers an archive that charges for memory.",
    tags: "fantasy,light-novel,steampunk,clockwork-archive",
    body: lines(
      "# Chapter 1: The Ledger That Breathed",
      "",
      "The Archive did not lend its pages. It rented them, a heartbeat at a time.",
      "Vael learned this the first night, when the brass turnstile refused her",
      "until a single copper thought left her palm and vanished into its gears.",
      "The hall beyond was endless: shelves of ticking books, each spine warm,",
      "each clasp humming like a held breath.",
      "\"You pay to remember here,\" said the Archivist, who was mostly hinges.",
      "\"And the dead pay to be remembered. It is a fair exchange.\"",
      "Vael had come for one volume only — her mother's, sealed and overdue.",
      "Its meter glowed red: forty-two heartbeats to open the first leaf.",
      "She counted her remaining copper thoughts. Eleven.",
      "\"Then you will read what you can afford,\" the Archivist said, not unkindly,",
      "\"and return when you are richer in either coin or sorrow.\"",
      "Vael pressed her palm to the meter and spent four heartbeats at once.",
      "The book exhaled. The first leaf turned itself, and her mother's hand",
      "appeared across the page, mid-sentence, as if interrupted only moments before.",
      "*If you are reading this,* it began, *then the Archive has finally let you in.*",
      "*I am sorry it cost you. Everything here does.*",
      "Vael read until her copper ran out, and the leaf cooled, and the clasp",
      "closed itself with the patience of something that knew she would be back.",
    ),
  },
  {
    creatorHandle: "novelist_kai", kind: "novel_chapter", pricePerLine: 0.00003,
    series: "the-clockwork-archive", chapterNo: 2,
    title: "The Clockwork Archive — Chapter 2: Interest, Compounded",
    summary: "Vael learns the Archive's debts can be inherited.",
    tags: "fantasy,light-novel,steampunk,clockwork-archive",
    body: lines(
      "# Chapter 2: Interest, Compounded",
      "",
      "By morning the meter on her mother's book had risen.",
      "Forty-two heartbeats had become forty-eight; unread debt, it seemed,",
      "accrued interest like any other.",
      "\"That is monstrous,\" Vael told the Archivist.",
      "\"That is bookkeeping,\" it replied, and oiled a knuckle.",
      "She found a smaller ledger near the children's stacks, priced at a",
      "single heartbeat a leaf, and read it for technique rather than truth.",
      "It told the story of a girl who paid for a stranger's memories and woke",
      "to find his debts now hers, his creditors now hers, his enemies — also hers.",
      "Vael closed it carefully. The lesson was not subtle.",
      "Somewhere deeper in the hall, a meter struck zero, and a book she could",
      "not see began, very softly, to scream.",
      "The Archivist did not look up. \"Someone's grief came due,\" it said.",
      "\"It happens, near the end of every month.\"",
      "Vael decided then that she would not merely read her mother's book.",
      "She would learn how the Archive priced a soul — and then she would,",
      "somehow, undercut it.",
    ),
  },
];

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log(`Seeding ${BASE} …`);
  for (const c of creators) {
    await post("/api/creators", c);
    console.log(`  creator @${c.handle}`);
  }
  for (const a of [...articles, ...novels]) {
    const { content } = await post("/api/content", a);
    console.log(`  content "${content.title}" (${content.line_count} lines, ${a.pricePerLine}/line)`);
  }
  console.log(`Done. ${creators.length} creators, ${articles.length} articles, ${novels.length} novel chapters.`);
}

main().catch((e) => {
  console.error("Seed failed:", e.message);
  console.error("Is the server running?  npm run dev  (in another terminal)");
  process.exit(1);
});
