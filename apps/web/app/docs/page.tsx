import Link from "next/link";

export const metadata = { title: "Docs · Skimflow" };

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
        <span className="label-caps text-primary">DOCUMENTATION</span>
        <h1 className="mt-1 font-display-lg text-display-lg-mobile md:text-display-lg">Get paid for your writing, one block at a time</h1>
        <p className="mt-2 max-w-2xl font-body-lg text-body-lg text-on-surface-variant">
          Skimflow lets you publish what you make (articles, serialized books, picture stories, or
          AI&nbsp;agent skills) and charge a tiny amount to unlock it. Readers see a free preview,
          then tap to read on; payment happens quietly in the background. Both people <em>and</em>
          {" "}autonomous AI agents can pay, in USDC, on the Arc test network. New here? This page
          walks you through the whole idea in a few minutes.
        </p>
      </header>

      {/* How it works — the mental model first */}
      <section className="mb-stack-lg grid grid-cols-1 gap-3 md:grid-cols-3">
        {[
          ["1", "You publish text", "Paste an article or an agent skill. We automatically split it into small “blocks” (a few paragraphs each)."],
          ["2", "Readers unlock blocks", "The first block is a free preview. Each block after it costs a few cents (or a fraction of a cent) to unlock."],
          ["3", "You get paid instantly", "Every unlock pays you in USDC. You keep 80%. Earnings show up live on your dashboard."],
        ].map(([n, title, body]) => (
          <div key={n} className="rounded-xl border border-outline-variant bg-surface-container-low p-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary font-data-mono text-[13px] text-on-primary">{n}</div>
            <div className="mt-2 font-label-lg text-label-lg">{title}</div>
            <p className="mt-1 font-body-sm text-on-surface-variant">{body}</p>
          </div>
        ))}
      </section>
      <p className="font-body-sm text-on-surface-variant">
        <strong>What&apos;s a “block”?</strong> It&apos;s just a chunk of your text, roughly a section or a
        few paragraphs. You write normally; we do the splitting. Readers pay per block, so they only
        pay for what they actually read.
      </p>

      {/* TOC */}
      <nav className="mb-stack-lg mt-stack-md flex flex-wrap gap-2">
        {[
          ["what", "What you can sell"],
          ["pricing", "Pricing & blocks"],
          ["publish", "Publishing"],
          ["humans", "How people read"],
          ["reading", "Reading & unlocking"],
          ["agents", "How AI agents buy"],
          ["discovery", "Agent discovery"],
          ["splits", "Your earnings"],
          ["live", "Going live"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="pill">{label}</a>
        ))}
      </nav>

      <H2 id="what">What you can sell</H2>
      <p className="font-body-md text-on-surface-variant">There are four kinds of content. They&apos;re read a little differently, but they&apos;re priced and paid for the same way: a free preview, then unlock the rest block by block.</p>
      <ul className="mt-stack-md grid grid-cols-1 gap-3 md:grid-cols-2">
        {[
          ["article", "Essays, reporting, blog posts, short fiction, anything prose. Readers get a clean reading view, unlocking block by block."],
          ["book", "Serialized, long-form fiction or non-fiction. Add chapters and pages from the Chapter Builder; readers turn pages in an immersive full-screen reader, paying per page as they go."],
          ["picture", "A Skimflow: an ordered sequence of images. The first is a free preview; each image after it unlocks on its own. Great for photo essays, comics, or step-by-steps."],
          ["agent-skills", "A reusable skill, system prompt, or knowledge file written for AI agents to buy and use. Served as Markdown at a machine-friendly endpoint."],
        ].map(([k, d]) => (
          <li key={k} className="rounded-lg border border-on-surface/10 bg-surface-container-lowest p-3">
            <span className="font-data-mono text-body-sm text-primary">{k}</span>
            <p className="font-body-sm text-on-surface-variant">{d}</p>
          </li>
        ))}
      </ul>

      <H2 id="pricing">Pricing &amp; blocks</H2>
      <p className="font-body-md text-on-surface-variant">You set one number: <strong>price per block</strong>, in US dollars (settled as USDC). That&apos;s it.</p>
      <ul className="mt-stack-md list-disc space-y-1 pl-6 font-body-md text-on-surface-variant">
        <li><strong>The first block is always free.</strong> It&apos;s the preview that convinces someone to pay for the rest. A paywall with no preview just gets skipped.</li>
        <li><strong>Price per block</strong> can be tiny, e.g. <span className="font-data-mono text-body-sm">0.002</span> ($0.002, a fifth of a cent). Pick whatever fits; you can change it any time.</li>
        <li><strong>Re-pricing is instant.</strong> Every unlock is quoted fresh, so a price change takes effect on the next reader.</li>
        <li><strong>Buy the whole piece.</strong> Readers can unlock everything in one tap for a small bulk discount (5% off the per-block total). Handy for a long article or a whole book.</li>
        <li><strong>One-tap reading.</strong> After a quick one-time setup, unlocks happen silently in the background, no wallet popup per block. A readers&apos;-side &ldquo;reading&nbsp;fuel&rdquo; balance shows how much is left.</li>
      </ul>

      <H2 id="publish">Publishing</H2>
      <p className="font-body-md text-on-surface-variant">
        The easy way: open the <Link href="/dashboard" className="text-primary">Creator Dashboard</Link>, sign in
        with Google or GitHub, add a payout wallet, and hit <strong>New content</strong> for an article, Skimflow, or
        agent skill. Paste your text or image links, set a price, publish. Done in under a minute. Writing long-form?
        Use <strong>New book</strong> to open the Chapter Builder: add chapters, split pages with a{" "}
        <span className="font-data-mono text-body-sm">---</span> line, and publish the whole book at once.
      </p>
      <p className="mt-stack-md font-body-md text-on-surface-variant">Prefer the API? Once you&apos;re signed in, your browser session can post to the same endpoint the dashboard uses:</p>
      <Code lang="http">{`POST /api/creator/content      (requires you to be signed in)`}</Code>
      <Code lang="json">{`{
  "title": "Resilient web-scraper skill",
  "contentType": "agent-skills",       // or "article"
  "summary": "A battle-tested extraction routine with retries + backoff.",
  "tags": "scraping,agents,python",
  "pricePerBlock": 0.002,              // US dollars per block
  "status": "published",               // or "draft"
  "body": "# Web Scraper Skill\\nYou are a careful extraction agent...\\n..."
}`}</Code>
      <p className="font-body-sm text-on-surface-variant">Your text is split into blocks automatically. For articles the first block is the free preview; for agent-skills a free intro block is generated for you and your blocks start at block 1.</p>

      <H2 id="humans">How people read</H2>
      <p className="font-body-md text-on-surface-variant">
        Every piece has a public page at <span className="font-data-mono text-body-sm">/read/&lt;slug&gt;</span>. A reader
        sees the title, summary, and the free first block. To read more they bring a little USDC on Arc testnet, either
        with their own wallet, or a free in-app wallet they can create in a couple of taps (no download). The first unlock
        runs a quick one-time setup; after that, tapping <em>Read on</em> unlocks the next block silently, with no popup.
        Unlocked blocks stay unlocked on that device. No account or subscription required.
      </p>
      <p className="mt-stack-md font-body-md text-on-surface-variant">
        <strong>Books</strong> open in an immersive full-screen reader: turn pages by tapping the edges, swiping, or the
        arrow keys, and each new page is paid for invisibly as you reach it. <strong>Skimflows</strong> reveal one image
        at a time. Any reader can also unlock the whole piece at once for the bulk discount.
      </p>

      <H2 id="reading">Reading &amp; unlocking</H2>
      <p className="font-body-md text-on-surface-variant">A quick guide to what a reader actually does on the page.</p>
      <h3 className="mt-stack-md font-label-lg text-label-lg">How reading works</h3>
      <ul className="mt-2 list-disc space-y-1 pl-6 font-body-md text-on-surface-variant">
        <li>You start on the <strong>free first block</strong>. Just scroll down to read it.</li>
        <li>Unlocked blocks read top to bottom like a normal article. Locked blocks appear blurred, with a <strong>Read on</strong> button where the text would continue.</li>
        <li>Everything you unlock stays unlocked on that device, so you can scroll back any time.</li>
      </ul>
      <h3 className="mt-stack-md font-label-lg text-label-lg">How unlocking works</h3>
      <ul className="mt-2 list-disc space-y-1 pl-6 font-body-md text-on-surface-variant">
        <li><strong>One block at a time.</strong> Tap <em>Read on</em> at a blurred block to reveal it. The first tap runs a quick one-time setup; after that each block unlocks silently with no popup.</li>
        <li><strong>The whole piece at once.</strong> Prefer not to tap block by block? Use <strong>Unlock the whole piece</strong> to reveal everything in a single payment, with a 5% bulk discount off the per-block total.</li>
        <li><strong>Reading fuel.</strong> A small gauge shows how much you have left to spend. When it runs low, add funds to keep reading without interruptions.</li>
        <li><strong>Books and Skimflows</strong> work the same way: turn the page (or reveal the next image) and it unlocks as you reach it.</li>
      </ul>

      <H2 id="agents">How AI agents buy (the interesting part)</H2>
      <p className="font-body-md text-on-surface-variant">
        Your agent-skills are also for sale to <em>software</em>. An autonomous agent can find your skill, see the
        price, pay, and use it, with no human involved. It works over plain HTTP using the
        {" "}<a href="https://www.x402.org" className="text-primary" target="_blank" rel="noreferrer">x402</a> “pay-to-unlock” pattern:
      </p>
      <ol className="mt-stack-md list-decimal space-y-1 pl-6 font-body-md text-on-surface-variant">
        <li>The agent fetches your skill and reads the <strong>free block 0</strong> to decide if it&apos;s relevant.</li>
        <li>It requests a paid block and gets back <span className="font-data-mono text-body-sm">HTTP 402 Payment Required</span> with a price quote.</li>
        <li>It pays the quoted USDC, then retries with a payment token and receives the block.</li>
      </ol>
      <Code lang="typescript">{`const base = "https://your-deployment";
const slug = "resilient-web-scraper-abc12";

// 1. Read the free intro block — no payment.
const intro = await fetch(\`\${base}/read/\${slug}/agent-skills.md\`).then(r => r.text());

// 2. Ask for a paid block → the server answers 402 with a price quote.
let res = await fetch(\`\${base}/read/\${slug}/agent-skills.md?block=1\`);
if (res.status === 402) {
  const quote = await res.json();
  // { cost_per_block, currency: "USDC", payment_gateway, instructions }

  // 3. Pay via Circle Gateway, then retry with the payment token.
  const token = await payViaCircleGateway(quote);   // your wallet, or the bundled SDK
  res = await fetch(\`\${base}/read/\${slug}/agent-skills.md?block=1\`, {
    headers: { "X-Payment-Token": token },
  });
}
const block = await res.text();   // the unlocked block — ready to use`}</Code>
      <p className="font-body-md text-on-surface-variant">
        Don&apos;t want to write any of that? This repo ships a ready-made buyer agent. Point it at any skill and it
        discovers, evaluates, pays, and returns a cited answer:
      </p>
      <Code lang="bash">{`npm run agent -- --url <deployment> --slug <slug> --simulate`}</Code>
      <p className="font-body-sm text-on-surface-variant"><span className="font-data-mono text-body-sm">--simulate</span> uses fake payments so you can try it with zero setup. Drop the flag (and add a funded wallet) for real testnet payments.</p>

      <H2 id="discovery">Agent discovery</H2>
      <p className="font-body-md text-on-surface-variant">
        Introducing an agent to Skimflow? Hand it these two well-known URLs. The first says <em>how</em> to pay
        (the x402 + Circle Gateway protocol, gateway address, currency); the second is the live catalog of <em>what</em>
        is for sale, so the agent can shop without any custom integration or scraping:
      </p>
      <Code lang="http">{`GET /.well-known/agent-payment.json      # how to pay (protocol + gateway)
GET /.well-known/agent-skills.json       # what's for sale (catalog of skills)`}</Code>
      <p className="font-body-md text-on-surface-variant">
        Each catalog entry is a self-describing x402 service — a free preview block, the paid-block resource URL,
        the price, and the payout address:
      </p>
      <Code lang="json">{`{
  "payment_protocol": "x402",
  "settlement": "circle-gateway-eip3009",
  "network": "eip155:5042002",
  "currency": "USDC",
  "services": [
    {
      "name": "Resilient web-scraper skill",
      "slug": "resilient-web-scraper-abc12",
      "price_per_block": "0.05",
      "preview_url": "https://<deployment>/read/resilient-web-scraper-abc12/agent-skills.md",
      "resource_url_pattern": "https://<deployment>/read/resilient-web-scraper-abc12/agent-skills.md?block={n}",
      "pay_to": "0x…",
      "payment_header": "X-Payment"
    }
  ]
}`}</Code>
      <p className="font-body-md text-on-surface-variant">
        The flow: read the catalog → fetch a skill&apos;s free <span className="font-data-mono text-body-sm">preview_url</span> to
        judge relevance → request a paid block and get a <span className="font-data-mono text-body-sm">402</span> quote →
        sign a USDC payment and retry with the <span className="font-data-mono text-body-sm">X-Payment</span> header
        (the same Circle Gateway rail humans use). The bundled buyer agent above does all of this for you.
      </p>

      <H2 id="splits">Your earnings</H2>
      <p className="font-body-md text-on-surface-variant">
        Every unlock splits automatically: <strong className="text-primary">80% to you</strong>, 12% to the platform,
        5% to a referrer if someone sent the reader your way, and 3% to a small reserve. When there&apos;s no referrer,
        that 5% folds into the reserve, so a no-referrer unlock is 80% you / 12% platform / 8% reserve. Payments land in
        the wallet you set on your <Link href="/dashboard" className="text-primary">dashboard</Link>, and your running
        total updates in real time.
      </p>

      <H2 id="live">Going live (real payments)</H2>
      <p className="font-body-md text-on-surface-variant">
        Out of the box, Skimflow runs in <strong>simulate mode</strong>: everything works end to end, but no real
        money moves, so it&apos;s perfect for trying things out. To settle real USDC on Arc testnet, set
        {" "}<span className="font-data-mono text-body-sm">PAYMENTS_MODE=live</span> plus your Circle credentials. The
        bundled Circle Gateway tooling (<span className="font-data-mono text-body-sm">npm run circle -- deposit / pay / balances</span>)
        handles the gas-free, batched on-chain settlement for you.
      </p>

      <div className="mt-stack-lg rounded-xl border border-outline-variant bg-surface-container-low p-stack-lg text-center">
        <h3 className="font-headline-sm text-headline-sm">Ready to try it?</h3>
        <p className="mb-stack-md font-body-md text-on-surface-variant">Publish your first article or skill in under a minute.</p>
        <div className="flex justify-center gap-gutter">
          <Link href="/dashboard" className="btn-primary px-8 py-3">Open Creator Dashboard</Link>
          <Link href="/for-you" className="btn-outline px-8 py-3">Browse the feed</Link>
        </div>
      </div>
    </div>
  );
}
