# LinePay Cite 🪙📖

### *Get paid every time someone reads a line of your story. Your readers pay per line — agents welcome.*

**Lepton Agents Hackathon · Canteen × Circle × Arc** — built for **RFB 6 (Creator & Publisher Monetization)**, with an autonomous paying agent for **RFB 1**.

LinePay Cite makes the smallest unit of writing — a single line — sellable. Creators put an **x402** paywall on articles and light-novel chapters; **both human readers and AI agents** pay **per line** (from $0.000001), settled gas-free as **USDC on Arc** through **Circle Gateway**, with an automatic **85/10/5** revenue split. The payment floor that forced everything into $10/month subscriptions is gone — so the lepton, the smallest coin, comes back as the nanopayment.

Runs **end-to-end out of the box in simulate mode** (no keys), and flips to **real Arc testnet USDC** with a few env vars.

> ⚠️ **Testnet only.** Everything in this repo targets **Circle's Arc testnet**. All USDC is **test USDC** (or the bundled `MockUSDC` faucet token) with no real-world value. All contracts deploy to testnet — the Hardhat config defines no mainnet, and every deploy script runs an `assertTestnet` guard that refuses known mainnet chain ids.

---

## Why this matters

## Why this wins (mapped to the judging rubric)

| Weight | Criterion | How LinePay Cite scores |
|---|---|---|
| **30%** | **Agentic Sophistication** | The buyer agent (LangChain + Claude `claude-opus-4-8`) genuinely *decides*: it discovers sources, reads free previews, scores relevance, picks line ranges, and chooses **whether the micro-payment is worth it** — then a **Guardian** policy independently authorizes the spend. Every decision is logged and rendered as a visible chain-of-thought. |
| **30%** | **Traction** | **Both sides of the market are real and live.** Humans pay per line on `/read`; the agent pays autonomously on `/demo`. A live stats bar shows real volume, payment count, and the human/agent split during the event window — exactly "creators earning and readers paying." |
| **20%** | **Circle tool usage** | **x402** (per-request paywall), **Circle Gateway nanopayments** (gas-free batched settlement, $0.000001 floor), **USDC on Arc**, **Circle Contracts** (on-chain `RevenueSplit`), and **Circle Agent Stack** (agent wallet). Mirrors the `circlefin/arc-nanopayments` reference end to end. |
| **20%** | **Innovation** | **Pay-per-citation**: when an agent grounds an answer in a line range, the citation *is* the payment, with a tx-hash receipt as provenance (RFB 6 Prior Art #1). Per-line granularity turns "what should this cost?" into a decision made thousands of times an hour. |

---

## Quick start (one command)

> Requires Node ≥ 20.6.

```bash
cd lepton-linepay-cite
bash scripts/setup.sh
```

Installs deps, starts the server, seeds **4 creators / 8 articles / 2 novel chapters**, and generates demo traffic (human reads + agent runs) so the dashboards are already live. Then open:

- **http://localhost:3000/read** — read an article, hit the paywall, **pay per line** (you are the reader).
- **http://localhost:3000/demo** — type a query, **watch the agent pay** creators autonomously.
- **http://localhost:3000/creators** — pick a creator, see **earnings update in real time**.

CLI agent (full reasoning trace in your terminal):

```bash
npm run agent -- "How do nanopayments change online writing?"
npm run agent -- "continue reading The Clockwork Archive"
```

Manual setup:

```bash
cp .env.example .env && cp .env apps/web/.env.local
npm install
npm run dev          # terminal 1
npm run seed         # terminal 2 (server must be running)
npm run demo:traffic # optional — populate traction
```

---

## How a payment flows (x402 + Circle Gateway on Arc)

```
Reader/Agent ──GET /api/content/c1?lineStart=4&lineEnd=44──▶ Server
Reader/Agent ◀──────── 402 Payment Required + x402 quote ──── Server   (asset, amount, payTo, nonce)
   │  Guardian.checkPolicy(quote, spentSoFar)  → APPROVED/BLOCKED  (budget, max $/line, verified)
   │  GatewayClient.createPayment(...)         → signed authorization (gas-free, EIP-712)
Reader/Agent ──GET … + X-PAYMENT: <base64 auth>──────────▶ Server
                                  GatewayClient.settle() → USDC on Arc, batched
                                  splitRevenue() 85/10/5  → recorded
Reader/Agent ◀── 200 + text + X-PAYMENT-RESPONSE (tx receipt) ── Server
```

The first 3 lines are always free — a human reader judges the piece, and the agent judges relevance, before paying.

---

## The autonomous buyer agent (RFB 1)

`apps/agent` — pipeline, every step logged and shown live:

1. **Discover** `/api/catalog` → 2. **Preview** free lines → 3. **Evaluate** relevance + worth-paying (LLM-driven; see below) → 4. **Guardian** hard-enforces budget / max-price-per-line / verified preference → 5. **Pay** via x402 + Gateway on Arc → 6. **Extract & cite** (tx hash as provenance) → 7. **Synthesize** a cited answer or continued-reading prose.

**Pick your model (all optional, free-first).** The agent reasons through LangChain.js and auto-selects a provider:
- **Groq (free + fast)** — set `GROQ_API_KEY` ([console.groq.com/keys](https://console.groq.com/keys)); default model `llama-3.3-70b-versatile`.
- **Anthropic (Claude)** — set `ANTHROPIC_API_KEY`.
- **No key** — a deterministic heuristic brain, so the demo always runs offline.

Force a provider with `AGENT_PROVIDER=groq|anthropic`. The model used is shown in the agent's reasoning header and CLI output.

The agent wallet is a **Circle Agent Stack** wallet; in simulate mode it needs no signature.

## Guardian Lite (`GET/PUT /api/policy`)

```json
{ "budgetBaseUnits": "5000", "maxPricePerLine": "200", "maxPerPurchase": "2000", "requireVerified": false }
```

---

## Going live on Arc testnet (Canteen + Circle tooling)

One command installs the CLIs and prints the wallet/faucet steps:
```bash
npm run circle:setup     # installs @circle-fin/cli + the ARC CLI, guides wallet + faucet
```
Then, step by step:

1. **ARC CLI** (Canteen-hosted Arc testnet RPC + docs bundled for your coding agent):
   ```bash
   uv tool install git+https://github.com/the-canteen-dev/ARC-cli
   ```
   Put the RPC URL + chain id into `.env` (`ARC_RPC_URL`, `ARC_CHAIN_ID`). Docs: `arc-node.thecanteenapp.com` · `docs.arc.network`.
2. **Circle Gateway** — the integration follows Circle's real API and the official SDK (the `circlefin/arc-nanopayments` pattern):
   - **Settlement:** `POST /v1/x402/settle` on `https://gateway-api-testnet.circle.com` with `{ paymentPayload, paymentRequirements }` → `{ success, transaction, payer, network }` (`packages/sdk/src/gateway.ts`).
   - **Signing:** buyer signs an **EIP-3009** `TransferWithAuthorization` against the `GatewayWalletBatched` v1 EIP-712 domain (`validBefore` ≥ 7 days), zero gas; Gateway batches the on-chain settlement.
   - **Official SDK** (recommended): `@circle-fin/x402-batching` — buyer `GatewayClient({ chain: "arcTestnet", privateKey }).pay(url)`, seller `BatchFacilitatorClient.settle(...)`. Wrapped at `apps/agent/src/circle-gateway.ts`; drive it with `npm run circle -- pay|deposit|balances`.
   ```bash
   npm install -g @circle-fin/cli        # Node ≥ 20.18.2 — agent wallets + faucet + x402
   ```
   Set `CIRCLE_API_KEY`, `CIRCLE_CHAIN=arcTestnet`, and create funded `BUYER_*` / `SELLER_*` wallets. Docs: `developers.circle.com/gateway/nanopayments` · `developers.circle.com/agent-stack`.
3. **Deploy the revenue split:**
   ```bash
   npm run contracts:compile && npm run contracts:deploy   # prints REVENUE_SPLIT_ADDRESS
   ```
   Add `REVENUE_SPLIT_ADDRESS` to `.env` to route payments through the on-chain 85/10/5 split.
4. **Flip the switch:** `PAYMENTS_MODE=live`. Restart. Payments now settle real **test** USDC on Arc, gas-free via Circle Gateway.

The same code path runs in both modes — only `PAYMENTS_MODE` + the Circle/Arc vars differ (`packages/sdk/src/{arc,gateway}.ts`). Default `gateway-api-testnet.circle.com`; the official SDK resolves Arc config from the named chain `arcTestnet`.

> 🔐 **Never commit or paste API keys.** `CIRCLE_API_KEY` lives only in `.env` (gitignored). If a key is ever exposed, rotate it in the Circle console.

---

## On-chain Agent Marketplace (RainbowKit / Wagmi)

Alongside the off-chain x402 nanopayment flow, there's a **fully on-chain marketplace** for AI agent skills, prompts, and knowledge bases — real reads, writes, and events via Wagmi/Viem, **no mock data**.

- **Contract:** `contracts/contracts/AgentMarketplace.sol` — `publishContent` / `buyContent(id)` (USDC `transferFrom` buyer→author via SafeERC20 + ReentrancyGuard), on-chain `hasPurchased` access mapping, and `ContentPublished` / `ContentPurchased` events agents listen to for discovery. `MockUSDC.sol` (6-decimal faucet token) is included for testnets without a canonical USDC.
- **Frontend:** `/market` — RainbowKit wallet connect, the feed reads `getAllContent()` and auto-refetches on events, the unlock flow does **allowance check → `approve` → `buyContent`**, and content is revealed only after a signature + on-chain `hasAccess` check (`/api/reveal`). Publishing encrypts the body (AES-256-GCM), stores it on **IPFS via Pinata** (or local SQLite fallback), and writes the CID on-chain.
- **Key files:** `lib/wagmi.ts` (Arc chain + RainbowKit config), `app/providers.tsx`, `hooks/useMarketplace.ts`, `lib/marketplaceAbi.ts`, `lib/{ipfs,crypto}.ts`, `app/api/{ipfs,reveal}/route.ts`.

**Deploy (Hardhat → Arc testnet — test tokens only):**

First provision a funded testnet key + RPC with the Canteen ARC CLI, and set `ARC_RPC_URL` / `ARC_CHAIN_ID` / `DEPLOYER_PRIVATE_KEY` in `.env`:
```bash
uv tool install git+https://github.com/the-canteen-dev/ARC-cli
```
```bash
cd contracts && npm install
# test USDC faucet token (skip if the Arc testnet already exposes a USDC):
npm run deploy:mock-usdc                          # → <usdc>   (TEST token)
USDC_ADDRESS=<usdc> npm run deploy:marketplace    # → <marketplace>  (on arcTestnet)
# then in apps/web/.env.local:
#   NEXT_PUBLIC_USDC_ADDRESS=<usdc>
#   NEXT_PUBLIC_MARKETPLACE_ADDRESS=<marketplace>
#   NEXT_PUBLIC_ARC_RPC_URL / NEXT_PUBLIC_ARC_CHAIN_ID / NEXT_PUBLIC_WC_PROJECT_ID
```
The `…:marketplace` / `…:mock-usdc` scripts target `--network arcTestnet`; append `:local` (e.g. `deploy:marketplace:local`) for an in-memory dry run. Every deploy runs an `assertTestnet` guard. The `/market` page shows a setup screen until those are configured; the per-line `/read` + `/demo` flows work without any of it. In the wallet, the on-chain marketplace mints **test USDC** via the in-app faucet button.

**Routes:** `/` · `/read` (library) · `/content/[id]` (per-item reader — prose for articles, **locked code-block** for agent-skills/prompts) · `/market` (on-chain) · `/creators` · `/demo` · **`/docs`** (creator + agent-integration guide).

## Submission checklist (Lepton Agents Hackathon)

- [x] **Public GitHub repo** — this repo.
- [x] **Working product** — runs locally in one command; deploy to Vercel for a live link (frontend + API routes; set `PAYMENTS_MODE`, `APP_BASE_URL`, and `ANTHROPIC_API_KEY` as env vars).
- [x] **Both sides real** — human readers paying (`/read`) + autonomous agent paying (`/demo`), with a live traction stat bar.
- [x] **Circle stack** — x402, Gateway nanopayments, USDC on Arc, Contracts, Agent Stack.
- [ ] **< 3-min video demo** — script below.
- [ ] **Submit** at `forms.gle/SMqLaw2pMGDe58LFA` with GitHub link + video (+ live URL).

### Traction question answers (for the form)
- **Users onboarded:** seeded 4 creators + content; the demo-traffic generator + the live `/read` and `/demo` flows produce real human and agent payments during the event window (see the home stats bar for live totals).
- **User problem:** writers and publishers earn ~nothing from readers consuming work in tiny chunks, and *nothing* from the AI agents now reading their work as free substrate. Per-line nanopayments + pay-per-citation fix both.

---

## 3-minute demo video script

1. **0:00 — Hook (20s).** "Writers earn nothing when AI reads their work, and subscriptions are too coarse to sell one article. We made a single *line* sellable — on Arc." Show the home page + live stats bar ticking.
2. **0:20 — Human reader (40s).** Open `/read`, pick an article, read the free preview, hit the paywall, click **Pay & read 10 lines** — show the teal "Paid $0.000X to @creator · settled on Arc · tx…" confirmation. Unlock another chunk.
3. **1:00 — Autonomous agent (70s).** Open `/demo`, type *"How do nanopayments change online writing?"*, **Run Agent**. Narrate the chain-of-thought: discover → preview → **evaluate** → **Guardian APPROVED** → **pay via Circle Gateway on Arc** → cite. Show the tx hash and paid-sources list.
4. **2:10 — Money lands (30s).** Switch to `/creators`, pick `@ada_writes`, show earnings + transaction history. Back on `/demo`, point at the live feed tagging 👤 human vs 🤖 agent payments.
5. **2:40 — Continue-reading (15s).** Run *"continue reading The Clockwork Archive"* — the agent buys the next chapter's lines and stitches the prose.
6. **2:55 — Close (5s).** "x402 · Circle Gateway · USDC on Arc. Make the smallest unit sellable."

---

## API reference (selected)

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/content/:id?lineStart&lineEnd` | x402-protected per-line read (402 → pay → 200) |
| `GET` | `/api/content/:id/meta` | reader metadata + free preview |
| `POST` | `/api/reader/:id` | human pay-per-line settlement |
| `POST` | `/api/research` | ⭐ run the autonomous buyer agent |
| `POST` | `/api/content` · `/api/creators` | publish content · register creator |
| `GET` | `/api/creators/:handle/earnings` · `/api/feed` · `/api/stats` | dashboards + live feed + traction |
| `GET/PUT` | `/api/policy` | Guardian policy |

## Tech stack

Next.js 15 · TypeScript · LangChain.js (Groq / Claude / heuristic) · RainbowKit + Wagmi/Viem · better-sqlite3 · Solidity (Hardhat, OpenZeppelin) · Tailwind (editorial design system) · **Circle Gateway (`@circle-fin/x402-batching`) · x402 (`/v1/x402/settle`, EIP-3009) · USDC on Arc · Circle Agent Stack + Circle CLI**.

---

Built for the Lepton Agents Hackathon (Canteen × Circle × Arc). Simulate mode is for the judges' convenience; the on-chain path is real Arc testnet USDC via Circle Gateway.
