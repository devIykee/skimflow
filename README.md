# Skimflow Cite 🪙📖

### *Get paid every time someone reads a line of your story. Your readers pay per line — agents welcome.*

**Lepton Agents Hackathon · Canteen × Circle × Arc** — built for **RFB 6 (Creator & Publisher Monetization)**, with an autonomous paying agent for **RFB 1**.

Skimflow Cite makes the smallest unit of writing — a single line — sellable. Creators put an **x402** paywall on articles and light-novel chapters; **both human readers and AI agents** pay **per line** (from $0.000001), settled gas-free as **USDC on Arc** through **Circle Gateway**, with an automatic **85/10/5** revenue split. The payment floor that forced everything into $10/month subscriptions is gone — so the lepton, the smallest coin, comes back as the nanopayment.

Runs **end-to-end out of the box in simulate mode** (no keys), and flips to **real Arc testnet USDC** with a few env vars.

> ⚠️ **Testnet only.** Everything in this repo targets **Circle's Arc testnet**. All USDC is **test USDC** (or the bundled `MockUSDC` faucet token) with no real-world value. All contracts deploy to testnet — the Hardhat config defines no mainnet, and every deploy script runs an `assertTestnet` guard that refuses known mainnet chain ids.

---

## Quick start (one command)

> Requires Node ≥ 20.6.

```bash
cd lepton-skimflow-cite
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
