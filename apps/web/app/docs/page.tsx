import Link from "next/link";

export const metadata = { title: "Creator Docs — LinePay Cite" };

function Code({ children, lang }: { children: string; lang?: string }) {
  return (
    <pre className="my-stack-md overflow-x-auto rounded-xl border border-on-surface/15 bg-[#0b0c10] p-4 font-data-mono text-[12.5px] leading-relaxed text-[#e4e2dd]">
      {lang && <div className="mb-2 select-none font-label-caps text-[10px] uppercase text-white/40">{lang}</div>}
      <code className="whitespace-pre">{children}</code>
    </pre>
  );
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-stack-lg scroll-mt-24 border-b border-outline-variant pb-2 font-headline-md text-headline-md">
      {children}
    </h2>
  );
}

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-4xl px-margin-mobile py-stack-lg md:px-margin-desktop">
      <header className="mb-8">
        <span className="label-caps text-primary">CREATOR DOCUMENTATION</span>
        <h1 className="mt-1 font-display-lg text-display-lg-mobile md:text-display-lg">Publish &amp; monetize, by the line</h1>
        <p className="mt-2 max-w-2xl font-body-lg text-body-lg text-on-surface-variant">
          Whether you write articles, light-novel chapters, AI agent skills, prompt templates, or
          knowledge bases — price your text <strong>per line</strong> and get paid by humans and
          autonomous agents alike, settled as USDC on Arc.
        </p>
      </header>

      {/* TOC */}
      <nav className="mb-stack-lg flex flex-wrap gap-2">
        {[
          ["what", "What you can sell"],
          ["format", "Formatting & pricing"],
          ["upload", "Uploading"],
          ["x402", "The x402 endpoint"],
          ["agent", "Agent integration"],
          ["circle", "Circle Gateway SDK"],
          ["onchain", "On-chain marketplace"],
          ["splits", "Revenue splits"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="pill">{label}</a>
        ))}
      </nav>

      <H2 id="what">What you can sell</H2>
      <p className="font-body-md text-on-surface-variant">Every item has a <span className="font-data-mono text-body-sm">kind</span>. It only changes how the reader renders — articles get a prose reader; skills/prompts/knowledge get a locked code-block view.</p>
      <ul className="mt-stack-md grid grid-cols-1 gap-3 md:grid-cols-2">
        {[
          ["article", "Essays, reporting, blog posts — prose reader."],
          ["novel_chapter", "Serial fiction; supports a series + chapter number."],
          ["agent-skill", "A reusable capability/system prompt an agent buys to execute a task."],
          ["prompt-template", "Parameterized prompts; sold per line, code-block view."],
          ["knowledge-base", "Reference fragments an agent cites to ground an answer."],
        ].map(([k, d]) => (
          <li key={k} className="rounded-lg border border-on-surface/10 bg-surface-container-lowest p-3">
            <span className="font-data-mono text-body-sm text-primary">{k}</span>
            <p className="font-body-sm text-on-surface-variant">{d}</p>
          </li>
        ))}
      </ul>

      <H2 id="format">Formatting &amp; pricing</H2>
      <p className="font-body-md text-on-surface-variant">Content is Markdown. Pricing is per <em>line</em> (a line is any <span className="font-data-mono text-body-sm">\n</span>-separated row, blank lines included — exactly what a reader is charged for). The first <span className="font-data-mono text-body-sm">freeLines</span> are a free preview so humans and agents can judge relevance before paying.</p>
      <ul className="mt-stack-md list-disc space-y-1 pl-6 font-body-md text-on-surface-variant">
        <li><strong>pricePerLine</strong>: dollars, e.g. <span className="font-data-mono text-body-sm">0.00005</span> ($0.00005/line). Floor is $0.000001.</li>
        <li><strong>freeLines</strong>: default 3. Keep a hook; a paywall with no preview gets skipped, not paid.</li>
        <li>Re-price anytime — quotes are generated per request, so changes take effect immediately.</li>
      </ul>

      <H2 id="upload">Uploading</H2>
      <p className="font-body-md text-on-surface-variant">Use the <Link href="/creators" className="text-primary">Creator Portal</Link>, or POST directly:</p>
      <Code lang="bash">{`curl -X POST http://localhost:3000/api/content \\
  -H 'content-type: application/json' \\
  -d '{
    "creatorHandle": "ada_writes",
    "kind": "agent-skill",
    "title": "Resilient web-scraper skill",
    "summary": "A battle-tested extraction routine with retries + backoff.",
    "tags": "scraping,agents,python",
    "pricePerLine": 0.0002,
    "freeLines": 4,
    "body": "# Web Scraper Skill\\nYou are a careful extraction agent...\\n..."
  }'`}</Code>
      <p className="font-body-sm text-on-surface-variant">Register your creator + wallet first (<span className="font-data-mono text-body-sm">POST /api/creators</span> with <span className="font-data-mono text-body-sm">{`{ handle, wallet }`}</span>), or do both in the portal UI.</p>

      <H2 id="x402">The x402 endpoint</H2>
      <p className="font-body-md text-on-surface-variant">Every piece is automatically protected at:</p>
      <Code lang="http">{`GET /api/content/:id?lineStart=4&lineEnd=44`}</Code>
      <p className="font-body-md text-on-surface-variant">Unpaid requests for a paid range get <span className="font-data-mono text-body-sm">HTTP 402</span> with a machine-readable quote:</p>
      <Code lang="json">{`{
  "x402Version": 1,
  "error": "payment_required",
  "accepts": [{
    "scheme": "gateway-exact",
    "network": "arc-testnet",
    "amount": "8000",            // USDC base units (6 decimals)
    "asset": "0x...USDC",
    "payTo": "0x...creatorOrSplit",
    "resource": ".../api/content/c_abc?lineStart=4&lineEnd=44",
    "nonce": "0x...",
    "extra": { "lineCount": 40, "pricePerLine": "200", "creatorHandle": "ada_writes" }
  }]
}`}</Code>
      <p className="font-body-md text-on-surface-variant">Pay by retrying with the signed Circle Gateway authorization in the <span className="font-data-mono text-body-sm">X-PAYMENT</span> header. On success you get the text plus an <span className="font-data-mono text-body-sm">X-PAYMENT-RESPONSE</span> receipt (the on-chain tx hash — your citation provenance).</p>

      <H2 id="agent">Agent integration (the part that wins)</H2>
      <p className="font-body-md text-on-surface-variant">Any external agent can buy your skill. With the bundled SDK:</p>
      <Code lang="typescript">{`import { GatewayClient, loadArcConfig, decodePayment, encodePayment } from "@linepay/sdk";

const base = "https://your-deployment";
const gw = new GatewayClient(loadArcConfig());
const agentWallet = "0xYourAgentWallet";

// 1) hit the paywalled range
let res = await fetch(\`\${base}/api/content/\${id}?lineStart=4&lineEnd=44\`);
if (res.status === 402) {
  const { accepts: [req] } = await res.json();

  // 2) (your Guardian policy decides here: budget, max $/line, relevance)

  // 3) sign a gas-free Gateway authorization and retry
  const payment = await gw.createPayment(req, agentWallet, process.env.AGENT_WALLET_PRIVATE_KEY);
  res = await fetch(req.resource, { headers: { "x-payment": encodePayment(payment) } });
}
const { text, txHash } = await res.json();   // txHash = payment receipt to cite`}</Code>
      <p className="font-body-md text-on-surface-variant">Or just point the built-in agent at your content — see the <Link href="/demo" className="text-primary">Agent Demo</Link>. It discovers, evaluates, clears its Guardian spend policy, pays, and returns a cited answer where every citation carries the tx hash.</p>

      <H2 id="circle">Circle Gateway — official SDK (production path)</H2>
      <p className="font-body-md text-on-surface-variant">For real testnet settlement, use Circle&apos;s official x402 batching SDK (the <span className="font-data-mono text-body-sm">circlefin/arc-nanopayments</span> pattern). The <strong>buyer</strong> signs an EIP-3009 authorization off-chain (zero gas); <strong>Gateway batches</strong> many authorizations into one on-chain settlement on Arc via <span className="font-data-mono text-body-sm">POST /v1/x402/settle</span>.</p>
      <Code lang="bash">{`npm install @circle-fin/x402-batching viem
npm install -g @circle-fin/cli      # Circle Agent Stack: wallets, faucet, x402`}</Code>
      <p className="font-body-md text-on-surface-variant"><strong>Buyer</strong> (the agent) — handles the whole 402 → sign → retry internally:</p>
      <Code lang="typescript">{`import { GatewayClient } from "@circle-fin/x402-batching/client";

const client = new GatewayClient({
  chain: "arcTestnet",
  privateKey: process.env.BUYER_PRIVATE_KEY as \`0x\${string}\`,
});

await client.deposit("5");                 // fund the Gateway unified balance
const { data, status } = await client.pay(url);   // pays the x402 paywall, returns content`}</Code>
      <p className="font-body-md text-on-surface-variant">In this repo: <span className="font-data-mono text-body-sm">npm run circle -- pay &lt;url&gt;</span> / <span className="font-data-mono text-body-sm">deposit</span> / <span className="font-data-mono text-body-sm">balances</span> (live mode). <strong>Seller</strong> — protect + settle:</p>
      <Code lang="typescript">{`import { createGatewayMiddleware, BatchFacilitatorClient } from "@circle-fin/x402-batching/server";

const facilitator = new BatchFacilitatorClient({ url: "https://gateway-api-testnet.circle.com" });
app.use(createGatewayMiddleware({ payTo: process.env.SELLER_ADDRESS, facilitator }));
// or settle a decoded PAYMENT payload directly:
const settlement = await facilitator.settle(paymentPayload, paymentRequirements);
// → { success, transaction, payer, network }`}</Code>
      <p className="font-body-sm text-on-surface-variant">Set <span className="font-data-mono text-body-sm">PAYMENTS_MODE=live</span> + <span className="font-data-mono text-body-sm">CIRCLE_API_KEY</span> + <span className="font-data-mono text-body-sm">BUYER_PRIVATE_KEY</span> and run <span className="font-data-mono text-body-sm">bash scripts/circle-setup.sh</span> to install the CLIs and create funded testnet wallets.</p>

      <H2 id="onchain">On-chain marketplace (alternative)</H2>
      <p className="font-body-md text-on-surface-variant">Prefer a whole-item, fully on-chain sale? Publish to the <span className="font-data-mono text-body-sm">AgentMarketplace</span> contract from the <Link href="/market" className="text-primary">Marketplace</Link>. Buyers <span className="font-data-mono text-body-sm">approve()</span> USDC then <span className="font-data-mono text-body-sm">buyContent(id)</span>; funds go buyer→author directly, access is recorded on-chain, and agents discover new skills by listening to the <span className="font-data-mono text-body-sm">ContentPublished</span> event:</p>
      <Code lang="typescript">{`import { createPublicClient, http, parseAbiItem } from "viem";
const client = createPublicClient({ transport: http(process.env.ARC_RPC_URL) });
const unwatch = client.watchEvent({
  address: process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS,
  event: parseAbiItem("event ContentPublished(uint256 indexed id, address indexed author, string cid, string title, uint256 price)"),
  onLogs: (logs) => logs.forEach((l) => console.log("new skill:", l.args.title, l.args.price)),
});`}</Code>

      <H2 id="splits">Revenue splits</H2>
      <p className="font-body-md text-on-surface-variant">Every nanopayment splits automatically: <strong className="text-primary">85% creator</strong> / 10% platform / 5% referrer. When the <span className="font-data-mono text-body-sm">RevenueSplit</span> contract is deployed and set as <span className="font-data-mono text-body-sm">payTo</span>, the split happens atomically on-chain; otherwise the creator is paid directly and the split is recorded off-chain. Your earnings update in real time on the <Link href="/creators" className="text-primary">Creator Portal</Link>.</p>

      <div className="mt-stack-lg rounded-xl border border-outline-variant bg-surface-container-low p-stack-lg text-center">
        <h3 className="font-headline-sm text-headline-sm">Ready?</h3>
        <p className="mb-stack-md font-body-md text-on-surface-variant">Publish your first skill or article in under a minute.</p>
        <div className="flex justify-center gap-gutter">
          <Link href="/creators" className="btn-primary px-8 py-3">Open Creator Portal</Link>
          <Link href="/market" className="btn-outline px-8 py-3">On-chain Marketplace</Link>
        </div>
      </div>
    </div>
  );
}
