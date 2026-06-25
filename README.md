# Skimflow

**Pay-per-block reading for people and AI agents.**

Skimflow makes the smallest unit of content — a single *block* (a few paragraphs, one image, one page of a book) — independently sellable. Creators publish articles, photo essays, agent skills, and books behind an [x402](https://www.x402.org/) paywall; both human readers and AI agents pay per block, settled gas-free as USDC on Arc through Circle Gateway, with an automatic 80/12/5/3 revenue split.

For human readers the payment layer stays out of the way: a one-time setup, after which every block unlocks with no wallet popup, drawn from a prepaid "reading fuel" balance. For agents, a small set of machine-readable endpoints turns the catalogue into a pay-per-request API.

The project runs end-to-end in **simulate mode** with no keys or funds, and switches to real **Arc testnet** USDC through a few environment variables.

- **Live:** [skimflow.vercel.app](https://skimflow.vercel.app)
- **Docs:** [Creator guide](https://skimflow.vercel.app/docs) · [Partners & Developers](https://skimflow.vercel.app/partners) ([md](docs/PARTNERS.md)) · [White paper](https://skimflow.vercel.app/whitepaper) ([md](docs/WHITEPAPER.md)) · [Circle tooling feedback](CIRCLE_FEEDBACK.md)
- **Contributing:** see [CONTRIBUTING.md](CONTRIBUTING.md)

> **Testnet only.** Everything targets Circle's Arc testnet (chain id `5042002`). All USDC is test USDC with no real-world value. Contracts deploy to testnet only; every deploy script runs an `assertTestnet` guard that refuses known mainnet chain ids.

---

## Quick start

> Requires Node ≥ 20.6 and Docker (for the local Postgres — auto-started when no `DATABASE_URL` is set).

```bash
cd skimflow
npm install
npm run up            # ensures a DB, migrates, seeds demo content, starts the server
```

`npm run up` is zero-config: with no `DATABASE_URL` it boots a local Postgres in Docker; with one (e.g. Supabase) it uses that and skips Docker. Then open:

- `http://localhost:3000/for-you` — the feed: articles, agent skills, photo essays, and books.
- `http://localhost:3000/read/<slug>` — read a piece, hit the paywall, unlock block by block.
- `http://localhost:3000/dashboard` — publish content, track earnings, manage your wallet.
- `http://localhost:3000/docs` — the creator and agent-integration guide.

Useful variants:

```bash
npm run up:fresh                 # reset the local Docker DB + .next, then start
bash scripts/dev.sh --traffic    # also generate simulate-mode demo unlocks (off by default)
npm run db:seed:chioma           # add the @chiomawrites sample set (articles, skills, books, photo essays)
npm run db:purge-demo            # dry run: show all demo/seed data; add `-- --yes` to delete it
```

Drive the buyer agent against your running server (full reasoning and payment trace):

```bash
npm run agent -- --url http://localhost:3000 --slug <agent-skill-slug> --simulate
npm run test:x402 -- --url http://localhost:3000 --slug <agent-skill-slug> --simulate   # spec-compliance harness
```

---

## What you can publish

| Type | Unit sold | Reader experience |
|---|---|---|
| Article | a chunk (~6 lines / 400 words) | vertical reader; block 0 free, the rest blur until unlocked |
| Agent Skill | a skill block | a `.md` endpoint agents pay per block to read |
| Picture story | one image | first image free, each subsequent image is a paid unlock |
| Book | one page | full-screen reader (chapters → pages), swipe or arrow keys to turn |

The first block of anything is a free preview. The only price ever shown to a human is the optional "unlock the whole piece" upsell (a 5% bulk discount); per-block unlocks simply read "Read on."

---

## How payments work

**Silent per-block payments (humans).** A reader completes a one-time setup: deposit USDC into their Circle Gateway balance and `addDelegate` a locally generated session key. After that, each block unlocks by having the session key sign an EIP-712 burn intent that a relayer settles through Gateway — no wallet popup per block. The UI shows a "reading fuel" gauge over the raw USDC balance, warns when it runs low, and offers a one-tap top-up. A session can be ended at any time; the Gateway balance remains and "Read on" resumes against it.

**Wallets.** Every account is provisioned a Circle **developer-controlled wallet** automatically at signup — no PIN, no download, no manual connect step. The admin account is the exception: it signs with an external wallet (RainbowKit / Wagmi). The silent-pay path is identical regardless of wallet type.

**Revenue split — 80/12/5/3.** Every payment splits creator 80% · platform 12% · referrer 5% · reserve 3%, routed on-chain through the `RevenueSplit` contract. With no referrer it becomes 80/12/0/8 (the referrer share rolls into reserve). Creators and admins read their own work for free.

**Simulate vs live.** The same code path runs in both modes; only `PAYMENTS_MODE` and the Circle/Arc environment variables differ. Simulate needs no keys or funds (useful for review); live settles real test USDC on Arc.

---

## For AI agents (x402)

Agents discover and pay for content without scraping HTML, via three endpoints:

| Endpoint | What it is |
|---|---|
| `/deploy` | Single entry point — protocol, catalogue, manifest, and a worked example in one URL. JSON by default, HTML in a browser. |
| `/.well-known/agent-payment.json` | How to pay — protocol (`x402`), settlement (`circle-gateway-eip3009`), network (`eip155:5042002`), USDC + gateway addresses, the `GatewayWalletBatched` EIP-712 domain. |
| `/.well-known/agent-skills.json` | What's for sale — a machine-readable catalogue of agent skills: slug, price, payable blocks, `preview_url`, `resource_url_pattern`, `pay_to`. |
| `/read/{slug}/agent-skills.md` | The resource itself — block 0 free; `?block=n` (n ≥ 1) returns a 402 quote, then the unlocked block once an `X-Payment` header is supplied. |

The flow is the canonical x402 loop: `GET → 402 quote → sign EIP-3009 / build burn intent → retry with X-Payment → 200 + content`, with an `X-Payment-Response` receipt. Every Agent Skill card has a "Share with Agent" button that copies this payload.

The buyer agent (`apps/agent`, LangChain) runs the loop autonomously under a Guardian spend policy (`packages/sdk/src/guardian.ts`), clearing every payment through `checkPolicy` (per-purchase and total budget) before paying. `npm run test:x402` asserts spec compliance at each step and exits non-zero on failure.

---

## Distribution (RSS)

Every creator has a public profile and an RSS 2.0 feed, addressable by either UUID or username:

- `/creator/:creatorId` — public profile with the creator's published posts and an auto-discoverable feed `<link>`.
- `/api/creators/:creatorId/feed.xml` — RSS 2.0 feed. Free posts syndicate in full; paid posts syndicate as the free teaser only, with a link back to Skimflow. Paid block content is never emitted.
- `/api/creators/:creatorId/posts` — the public JSON posts API that backs the feed (`?page`, `?limit`).

An optional [RSSHub](https://docs.rsshub.app/) route lives in [`integrations/rsshub/`](integrations/rsshub/) for syndication through the RSSHub ecosystem.

---

## Routes

`/` · `/for-you` (feed) · `/read/[slug]` (reader) · `/creator/[creatorId]` (public profile) · `/dashboard` (publish / earnings / wallet) · `/dashboard/create-book` (chapter builder) · `/dashboard/settings` · `/docs` · `/marketplace` · `/login` · `/terms` · `/admin/*` (moderation, payments, users, wallets, agents)

## API reference (selected)

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/reader/:slug` | Per-block unlock: quote → settle (silent session key, direct tx, or whole-piece). |
| `GET` | `/read/:slug/agent-skills.md?block=n` | x402-protected agent read (402 → pay → 200). |
| `GET` | `/.well-known/agent-payment.json` · `/.well-known/agent-skills.json` | Agent discovery: how to pay · what's for sale. |
| `POST` | `/api/pay-session/init` · `/resume` · `/revoke` · `GET /balance` | Reading-fuel session lifecycle. |
| `GET` | `/api/wallet/overview` · `/api/wallet/balance` · `/api/wallet/tx-status` | Wallet balances + history; transaction-status poll. |
| `POST` | `/api/wallet/embedded` · `/embedded/setup` · `/api/wallet/withdraw` | Wallet provisioning (server-side), silent-pay setup, withdrawal. |
| `POST` | `/api/creator/content` · `PATCH/GET/DELETE /api/creator/content/:id` | Publish / edit / load / remove content. |
| `GET` | `/api/creators/:creatorId/posts` · `/feed.xml` | Public posts API + RSS feed (by UUID or username). |
| `GET` | `/api/marketplace` · `/api/marketplace/search` | Feed listing + search. |
| `POST` | `/api/webhooks/circle` | Circle settlement webhook (finalizes pending live payments). |

## Going live on Arc

1. Point at the Arc testnet RPC (`https://rpc.testnet.arc.network`) and get test USDC from `faucet.circle.com`. Set `ARC_RPC_URL` / `ARC_CHAIN_ID` (`5042002`) and a funded `DEPLOYER_PRIVATE_KEY` in `.env`.
2. Deploy the revenue split and set `REVENUE_SPLIT_ADDRESS`:
   ```bash
   npm run contracts:compile && npm run contracts:deploy
   ```
   (A `RevenueSplit` is already live on Arc testnet at `0xBe1b9f844341701c36ee86F5248a0f9F1628C1E4`.)
3. Configure Circle: `CIRCLE_API_KEY`, the relayer / seller keys, and the Gateway base `https://gateway-api-testnet.circle.com`. For developer-controlled wallets, also register a `CIRCLE_ENTITY_SECRET`, create a wallet set (`npm run circle:walletset`), and set `CIRCLE_WALLET_SET_ID`; backfill existing accounts with `npm run db:backfill-wallets`.
4. Flip the switch: `PAYMENTS_MODE=live` and `NEXT_PUBLIC_PAYMENTS_MODE=live`, then restart. Payments now settle real test USDC on Arc, gas-free via Gateway.

> **Never commit or paste API keys or private keys.** Secrets live only in the gitignored repo-root `.env` (`apps/web/.env.local` is a symlink to it). Rotate any exposed key in the Circle console.

## Architecture

```
apps/web        Next.js 15 (App Router, React 19) · Postgres · NextAuth · Tailwind design tokens
                ├─ silent per-block pay sessions (Gateway burn intents)
                ├─ Circle developer-controlled wallets (auto-provisioned) + admin external wallet
                ├─ x402 well-known endpoints + agent-skills.md resource
                ├─ public posts API + per-creator RSS feeds + profiles
                └─ creator dashboard, Books builder, admin/moderation suite
apps/agent      LangChain buyer agent · x402 client · Guardian spend policy · test:x402 harness
packages/sdk    arc · gateway (x402 settlement, EIP-3009) · guardian · x402 · pricing
contracts       RevenueSplit.sol (80/12/5/3 router) · AgentMarketplace.sol · MockUSDC.sol (Hardhat)
db/migrations   numbered SQL migrations (users, pay-sessions, wallets, settlement retry, reports, images, books)
integrations    rsshub/ — standalone RSSHub route for creator feeds
```

## Tech stack

Next.js 15 · React 19 · TypeScript · PostgreSQL (`pg`) · NextAuth · Tailwind · LangChain.js (Groq / Claude) · RainbowKit + Wagmi / Viem · Solidity (Hardhat, OpenZeppelin) · Circle Gateway (x402 settlement, EIP-3009) · Circle developer-controlled wallets · USDC on Arc.
