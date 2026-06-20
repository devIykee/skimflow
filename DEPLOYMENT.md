# Skimflow Cite — Deployment Guide

Dual-sided nanopayment platform: humans pay per chunk (wallet), agents pay per
block (HTTP 402 + `X-Payment-Token` + Circle Gateway), on Arc testnet. Stack:
Next.js 15 (App Router) · Postgres · NextAuth · Circle Gateway · Upstash · Resend.

---

## 1. Environment Variables

Live in `apps/web/.env.local` (the Next app reads it; gitignored). `.env` at the
root is also read by the CLI scripts. **Never commit real secrets — only the
empty `.env.example` is tracked.** 🔒 = secret, never commit.

### Bare minimum to run locally (simulate mode)

Everything else has a safe default or a graceful fallback. To boot + log in you
need exactly these:

```
DATABASE_URL=                 # 🔒 Postgres connection string
NEXTAUTH_SECRET=              # 🔒 openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
ADMIN_EMAIL=you@gmail.com     # the email you sign in with → becomes admin
GOOGLE_CLIENT_ID=             # 🔒 (or use GitHub) — see §1.2
GOOGLE_CLIENT_SECRET=         # 🔒
PAYMENTS_MODE=simulate
```

> Tip: `npm run up` auto-generates `NEXTAUTH_SECRET` and, if `DATABASE_URL` is
> unset, starts a local Postgres via Docker. So in practice you only have to
> supply the OAuth credentials + `ADMIN_EMAIL`.

### 1.1 Core (required)

| Variable | Secret | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | 🔒 | — | Postgres. Supabase: use the **Session pooler** (IPv4) string. |
| `NEXTAUTH_SECRET` | 🔒 | — | `openssl rand -base64 32`. `AUTH_SECRET` also accepted. |
| `NEXTAUTH_URL` | | — | Your origin, e.g. `http://localhost:3000`. |
| `NEXT_PUBLIC_APP_URL` | | — | Your origin. Used for CORS + generated reader/agent URLs. |
| `ADMIN_EMAIL` | | — | Login email auto-promoted to `admin` on first sign-in. |
| `PAYMENTS_MODE` | | `simulate` | `simulate` (auto-approve) or `live` (real settlement + webhook). |

### 1.2 OAuth providers (need at least one to log in)

| Variable | Secret | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 🔒 | **Required.** console.cloud.google.com → Credentials → OAuth client (Web). |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 🔒 | Optional second provider. github.com/settings/developers → OAuth Apps. |

**OAuth redirect / callback URIs** (set these in the provider consoles):
- Google — Authorized redirect URI: `<NEXT_PUBLIC_APP_URL>/api/auth/callback/google`; JS origin: `<NEXT_PUBLIC_APP_URL>`
- GitHub — Authorization callback URL: `<NEXT_PUBLIC_APP_URL>/api/auth/callback/github`

(Google in "Testing" mode: add yourself under **Test users** or you'll get `access_denied`.)

### 1.3 Live payments (only when `PAYMENTS_MODE=live`)

| Variable | Secret | Default | Notes |
|---|---|---|---|
| `CIRCLE_API_KEY` | 🔒 | — | Circle developer API key. |
| `CIRCLE_WEBHOOK_SECRET` | 🔒 | — | HMAC secret to verify incoming webhooks (else they're rejected `403`). |
| `CIRCLE_GATEWAY_ADDRESS` | | `0x0077777d…A19B9` | GatewayWalletBatched contract (where agents pay). |
| `CIRCLE_GATEWAY_URL` | | `https://gateway-api-testnet.circle.com` | x402 settle host. |
| `GATEWAY_WALLET_ADDRESS` | | same default | Back-compat alias of `CIRCLE_GATEWAY_ADDRESS`. |
| `PLATFORM_WALLET_ADDRESS` | | — | Where the platform cut accrues / is swept. |
| `DEFAULT_PRICE_PER_BLOCK` | | `0.05` | Advertised in `/.well-known` (creators override per piece). |
| `BUYER_PRIVATE_KEY` | 🔒 | — | Funded Arc wallet the **agent** pays from (live agent flow). |
| `AGENT_WALLET_PRIVATE_KEY` | 🔒 | — | Back-compat alias of `BUYER_PRIVATE_KEY`. |
| `BUYER_ADDRESS` / `SELLER_ADDRESS` / `AGENT_WALLET_ADDRESS` | | — | Wallet addresses (display / back-compat). |

### 1.4 Arc chain (defaults are correct for testnet)

| Variable | Default |
|---|---|
| `ARC_RPC_URL` | `https://rpc.testnet.arc.network` |
| `ARC_CHAIN_ID` | `5042002` |
| `ARC_NETWORK_CAIP2` | `eip155:5042002` |
| `USDC_ADDRESS` | `0x3600…0000` (Arc testnet USDC, 6 decimals) |

### 1.5 Revenue split (mirrors the on-chain RevenueSplit contract)

The off-chain ledger and the deployed `RevenueSplit` contract use the **same**
fixed split: **creator 80% / platform 12% / referrer 5% / reserve 3%**. With no
referrer the 5% folds into the reserve (→ **80 / 12 / 0 / 8**). The creator's
share is always the remainder, so the four parts reconcile exactly.

These percentages are fixed in `lib/split-payment.ts` to match the contract —
the old `PLATFORM_FEE_RATE` / `REFERRER_FEE_RATE` env vars are **no longer read**.

| Variable | Secret | Default | Notes |
|---|---|---|---|
| `REVENUE_SPLIT_ADDRESS` | | — | Deployed `RevenueSplit` on Arc. Required for live settlement. |

### 1.5b Silent session payments (Phase 2 — `PAYMENTS_MODE=live`)

Lets readers sign **once** to authorize a local session key, then unlock every
following block with **no wallet popup**. Simulate mode needs none of the below
— the full popup-free UX works with no funds. For real settlement:

| Variable | Secret | Default | Notes |
|---|---|---|---|
| `RELAYER_PRIVATE_KEY` | 🔒 | — | Server EOA that calls `gatewayMint()` then `RevenueSplit.split()` per payment. Must hold test USDC on Arc (gas + a small fee float). Never a CLI flag, never logged. |
| `RELAYER_ADDRESS` | | derived from key | Recipient of the minted USDC; auto-derived from `RELAYER_PRIVATE_KEY` when unset. |
| `GATEWAY_MAX_FEE` | | `0` | Max Gateway fee (USDC base units) per burn; `0` for intra-Arc. |
| `NEXT_PUBLIC_PAYMENTS_MODE` | | `simulate` | Set `live` so the browser runs the on-chain deposit + `addDelegate` setup. |
| `NEXT_PUBLIC_GATEWAY_WALLET_ADDRESS` | | `0x0077777d…A19B9` | Gateway Wallet (deposit + delegate). |
| `NEXT_PUBLIC_GATEWAY_MINTER_ADDRESS` | | `0x0022222A…475B` | Gateway Minter (`gatewayMint`). |
| `NEXT_PUBLIC_ARC_GATEWAY_DOMAIN` | | `26` | Arc testnet Gateway/CCTP domain. |

**Live flow per unlock:** the session key silently signs a Gateway `BurnIntent`
→ the server verifies it + charges the cap → submits the burn (debits the
reader's unified balance) → the reader unlocks immediately → in the background
the relayer mints the USDC on Arc and calls `RevenueSplit.split(creator,
referrer, amount)`, flipping the ledger row `pending → completed`. Fund both the
**relayer** and each test **reader** wallet at <https://faucet.circle.com>.

### 1.6 Email (optional — without it, emails are silently skipped)

| Variable | Secret | Notes |
|---|---|---|
| `RESEND_API_KEY` | 🔒 | Default provider. |
| `POSTMARK_API_KEY` | 🔒 | Fallback if Resend is unset. |
| `EMAIL_FROM` | | Sender address; required for any email to send. |

### 1.7 Rate limiting (optional — falls back to in-memory)

| Variable | Secret | Default |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 🔒 | — (in-memory if unset; required for multi-instance) |
| `RATE_LIMIT_IMPORT` | | `10` |
| `RATE_LIMIT_AGENT_READ` | | `60` |
| `RATE_LIMIT_WEBHOOK` | | `200` |
| `RATE_LIMIT_ADMIN_SSE` | | `5` |
| `RATE_LIMIT_AUTH` | | `20` |
| `RATE_LIMIT_SEARCH` | | `30` |

### 1.8 Browser-exposed (`NEXT_PUBLIC_*`, defaults fine for testnet)

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_ARC_CHAIN_ID` | `5042002` | |
| `NEXT_PUBLIC_ARC_RPC_URL` | `https://rpc.testnet.arc.network` | |
| `NEXT_PUBLIC_ARC_EXPLORER_URL` | `https://testnet.arcscan.app` | |
| `NEXT_PUBLIC_USDC_ADDRESS` | `0x3600…0000` | |
| `NEXT_PUBLIC_WC_PROJECT_ID` | — | Optional; WalletConnect id (cloud.reown.com) to silence 403s. |

### 1.9 Other / optional

| Variable | Default | Notes |
|---|---|---|
| `APP_BASE_URL` | `http://localhost:3000` | Server/agent base URL (CLI scripts). |
| `PGSSL` | auto | `require` to force TLS, `disable` for local Postgres. |
| `PG_POOL_MAX` | `10` | Postgres pool size. |
| `AGENT_PROVIDER` / `GROQ_API_KEY` / `GROQ_MODEL` / `ANTHROPIC_API_KEY` / `AGENT_MODEL` / `CIRCLE_CHAIN` | — | 🔒 keys. Only for the legacy LLM research agent; not needed for the 402 flow. |

---

## 2. Database Setup

```bash
npm install
cd apps/web && npm run db:migrate     # applies db/migrations/*.sql idempotently
```

This creates all tables and the **full-text search index** (`content_search_idx`,
a GIN index over a `tsvector` maintained by the `content_search_tsv_trg` trigger)
plus the `payment_ledger` idempotency index. Migrations are tracked in
`_migrations` and are safe to re-run on every deploy.

**Supabase note (IPv4 networks / WSL):** the direct `db.<ref>.supabase.co` host
is IPv6-only. Use the **Session pooler** string instead:
`postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
TLS is auto-enabled for managed hosts.

### `admin_events` retention (90 days)

Bound the event table with a daily prune. **With `pg_cron`:**

```sql
SELECT cron.schedule('prune-admin-events', '17 3 * * *',
  $$DELETE FROM admin_events WHERE created_at < NOW() - INTERVAL '90 days'$$);
```

**Without `pg_cron`** (Vercel/managed without the extension), run this on a daily
schedule via your platform's cron, or call `pruneAdminEvents()` from a protected
job route:

```sql
DELETE FROM admin_events WHERE created_at < NOW() - INTERVAL '90 days';
```

---

## 3. Deployment Options

### Option A — Vercel
- **SSE** (`/api/admin/activity-stream`) is a long-lived stream. The route is
  `runtime = "nodejs"` + `dynamic = "force-dynamic"` and ships with
  `export const maxDuration = 60`; on Vercel the stream holds for up to 60s,
  then the client's `EventSource` auto-reconnects and replays via `Last-Event-ID`,
  so brief cutoffs are recovered. (Raise it on a plan that allows longer
  functions, or front the admin feed with an external pub/sub.)
- **Database pool on serverless:** each Vercel instance keeps its own pool, so
  keep `PG_POOL_MAX` small (**1–3**) to avoid exhausting a connection-limited
  pooler. Prefer Supabase's **Transaction pooler** (port **6543**) over the
  Session pooler (5432) for serverless — it's built for many short-lived
  connections.
- **Async CSV export** (`runExportJob`) writes to `os.tmpdir()` and continues
  after the response — on serverless this is best-effort. For reliable large
  exports use a background queue/worker (or run on Railway/Render).
- Set all env vars in the Vercel project; redeploy after changing `DATABASE_URL`.

### Option B — Railway / Render (recommended)
- No SSE/streaming limits and a persistent filesystem for async exports.
- Long-lived connections (admin feed) and background jobs work out of the box.
- Run `npm run db:migrate` as a release/predeploy command.

### Option C — Self-hosted VPS (Ubuntu + Nginx + PM2)
- **Nginx must not buffer SSE.** On the activity-stream location:
  ```nginx
  location /api/admin/activity-stream {
      proxy_pass http://127.0.0.1:3000;
      proxy_http_version 1.1;
      proxy_set_header Connection '';
      proxy_buffering off;              # required — else SSE is silently broken
      add_header X-Accel-Buffering no;  # belt-and-suspenders
      proxy_read_timeout 3600s;
  }
  ```
- **PM2 cluster mode:** in-memory rate limiting and the SSE connection counter
  are per-worker and do NOT share state. **Require Upstash Redis** in cluster
  mode (set `UPSTASH_REDIS_REST_URL`/`_TOKEN`).

### Circle webhook registration
Register the webhook in the Circle dashboard pointing at:
```
https://yourapp.com/api/webhooks/circle
```
Set its signing secret as `CIRCLE_WEBHOOK_SECRET`. Tampered/unsigned payloads
return `403` and are logged to `admin_events` as `WEBHOOK_REJECTED`.

---

## 4. End-to-End Test (copyable)

Run in `PAYMENTS_MODE=simulate` first. Replace `{slug}` with a published
agent-skills slug (publish one from `/dashboard`, or copy from the marketplace).

```bash
# 1. Start dev server
npm run dev          # in another terminal

# 2. Discover payment system
curl http://localhost:3000/.well-known/agent-payment.json

# 3. Full-text search marketplace
curl "http://localhost:3000/api/marketplace/search?q=solidity"

# 4. Fetch block 0 free
curl http://localhost:3000/read/{slug}/agent-skills.md

# 5. Attempt block 1 without payment — confirm 402
curl -v "http://localhost:3000/read/{slug}/agent-skills.md?block=1"

# 6. Simulate payment and retry — confirm block returned + rate limit headers
curl -v -H "X-Payment-Token: sim_test_token" \
     "http://localhost:3000/read/{slug}/agent-skills.md?block=1"

# 7. Fire a simulated Circle webhook — confirm ledger row finalized
curl -X POST http://localhost:3000/api/webhooks/circle \
     -H "Content-Type: application/json" \
     -d '{"type":"payment.confirmed","paymentId":"sim_test_token","amount":"0.05","currency":"USDC"}'

# 8. Confirm payment_ledger row status = 'completed'
#    psql "$DATABASE_URL" -c \
#      "SELECT block_index,status,gross_amount FROM payment_ledger WHERE payment_token='sim_test_token';"

# 9. Watch admin activity feed (needs an admin session cookie — copy it from the
#    browser devtools after signing in as ADMIN_EMAIL: cookie 'authjs.session-token')
curl -N http://localhost:3000/api/admin/activity-stream \
     -H "Cookie: authjs.session-token=<paste-admin-session-cookie>"

# 10. Check admin metrics updated
curl http://localhost:3000/api/admin/metrics \
     -H "Cookie: authjs.session-token=<paste-admin-session-cookie>"

# 11. Confirm agent_sessions upserted
#     psql "$DATABASE_URL" -c "SELECT session_key,total_402_hits,total_unlocks FROM agent_sessions;"

# 12. Test rate limiting — hit the agent route 61 times, expect 429 on the 61st
for i in $(seq 1 61); do
  curl -s -o /dev/null -w "%{http_code}\n" \
       "http://localhost:3000/read/{slug}/agent-skills.md?block=1"
done

# 13. Repeat for all blocks to confirm full sequential extraction (use the agent CLI):
cd apps/agent && npm run agent -- --url http://localhost:3000 --slug {slug} --simulate
```

Each step confirms the chain:
`402 → payment instructions → token sent → block returned → webhook fired →
ledger finalized → admin_events written → SSE feed updated → rate limit headers present`.

---

## 5. Post-Deploy Checklist

```
[ ] All env vars set in production
[ ] Database migrations run + full-text search index created
[ ] Google OAuth redirect URI updated to production domain
[ ] Circle webhook URL registered: https://yourapp.com/api/webhooks/circle
[ ] Circle webhook secret set as CIRCLE_WEBHOOK_SECRET
[ ] /.well-known/agent-payment.json returns correct production URLs
[ ] Marketplace loads, filter and search work
[ ] Creator login, publish, and agent URL generation work end-to-end
[ ] Agent flow tested end-to-end with PAYMENTS_MODE=live
[ ] Simulated webhook fired and ledger row confirmed as 'completed'
[ ] Payment ledger split amounts correct (creator = gross − platform − referrer)
[ ] Creator payout tested with small real amount + confirmation email received
[ ] PAYMENTS_MODE=live confirmed, simulate mode disabled
[ ] ADMIN_EMAIL set, admin login verified, /admin loads
[ ] Admin live feed shows real events
[ ] SSE reconnection tested (kill server briefly, reconnect, Last-Event-ID replay)
[ ] Rate limiting verified: 429 + Retry-After after limit exceeded
[ ] Trusted agent bypass tested: trusted=true gets 5× limit
[ ] CORS verified: agent curl works cross-origin; browser auth routes reject it
[ ] Circle webhook signature rejection tested: tampered payload returns 403
[ ] Creator wallet validation tested: malformed address rejected before storage
[ ] Creator earning email received after test payment
[ ] CSV export works for small (<10k, streamed) and large (>10k, async) datasets
[ ] admin_events retention cron scheduled (or manual process documented)
[ ] System health panel all green with PAYMENTS_MODE=live and Redis connected
[ ] Impersonation flow tested end-to-end (read-only enforced)
[ ] In-memory rate-limit warning appears on startup when UPSTASH vars missing
```

---

## 6. Rollback Strategy

- **Vercel / Railway / Render:** redeploy the previous build (Deployments →
  promote previous). All three keep immutable prior builds.
- **VPS / PM2:** `git checkout <prev-tag> && npm install && npm run build && pm2 reload all`.
- **Database:** migrations are additive and idempotent. To roll back a specific
  migration, apply a reverse SQL script and delete its row from `_migrations`:
  ```sql
  -- example: undo 0002_counters.sql
  DROP TABLE IF EXISTS counters;
  DELETE FROM _migrations WHERE name = '0002_counters.sql';
  ```
  Take a snapshot (`pg_dump`) before any destructive rollback.
```
