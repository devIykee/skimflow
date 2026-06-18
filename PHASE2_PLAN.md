# Phase 2 — Session-Key Silent Payments (Circle Gateway Delegate)

Goal: user signs ONCE at first unlock; every later chunk is debited silently (no
wallet popup). Settlement = real Circle Gateway delegate flow on Arc (domain 26),
routed through the deployed RevenueSplit (0xBe1b…C1E4).

## Confirmed mechanics (from Circle skill + docs)
- EIP-712 domain `{name:"GatewayWallet",version:"1"}`; primaryType `BurnIntent`
  {maxBlockHeight,maxFee,spec:TransferSpec}. TransferSpec fields/order exactly per
  `transfer-evm-delegate.md` (all addresses left-padded to bytes32; value 6-dec).
- Delegate auth: `addDelegate(address token,address delegate)` / `removeDelegate(...)`
  on Gateway Wallet 0x0077…A19B9, called by the depositor (per-token/chain).
- Deposit: `approve(USDC,gatewayWallet,amt)` then `deposit(USDC,amt)` on Gateway Wallet.
- Submit: POST `${gatewayUrl}/v1/transfer` body `[{burnIntent,signature}]` → `{attestation,signature}`.
- Mint: `gatewayMint(bytes,bytes)` on Minter 0x0022…475B (a tx → needs a funded relayer).
- Balance: POST `/v1/balances` {token:"USDC",sources:[{domain:26,depositor}]}.

## One-time setup (the ONLY popups)
1. Generate a session keypair in-browser (viem). Store priv in localStorage
   `linepay_paykey_<mainWallet>`; never leaves device.
2. User wallet txs: approve+deposit USDC into Gateway, then `addDelegate(USDC,sessionAddr)`.
3. POST /api/pay-session/init → persist session (DB) + issue jose JWT httpOnly cookie
   `linepay_pay_session` binding {mainWallet,sessionAddr,cap,exp}.

## Per-chunk silent flow
1. Session key builds + signs BurnIntent (sourceDepositor=mainWallet, sourceSigner=sessionAddr,
   destinationRecipient=RELAYER, 26→26, value=price). signTypedData via local viem account → NO popup.
2. POST /api/reader/[slug] { blockIndex, sessionPayment:{burnIntent,signature} }.
3. Server verifies: JWT cookie valid, sourceSigner==session, sourceDepositor==mainWallet,
   value==price, cap not exceeded (DB tally), idempotent on salt.
4. simulate (PAYMENTS_MODE!=live): record ledger completed, return text (full UX, no funds).
   live: submit burn → relayer gatewayMint → relayer RevenueSplit.split(creator,referrer,value)
   (relayer max-approves RevenueSplit once). Optimistic: return text after burn attested;
   finalize mint+split in background, ledger pending→completed.

## Files
NEW: lib/session-key.ts (jose JWT, like impersonation.ts) · lib/session-key-client.ts
(keypair gen/store, build+sign burn intent) · lib/gateway-relayer.ts (submitBurnIntent,
relayMint, splitOnChain, gatewayBalance; viem WalletClient w/ RELAYER_PRIVATE_KEY) ·
app/api/pay-session/{init,balance,revoke}/route.ts · components/PaySetupModal.tsx ·
components/BalanceChip.tsx (nav: "Balance $X.XX", poll, low-bal toast → top-up) ·
db/migrations/000X_pay_sessions.sql (+ reserve_amount on payment_ledger).
EDIT: app/read/[slug]/_components/ChunkReader.tsx (setup modal → silent path; keep
per-block wallet path as fallback) · app/api/reader/[slug]/route.ts (accept sessionPayment) ·
lib/split-payment.ts (align to deployed contract 80/12/5/3 + reserve) · app/layout.tsx
(mount BalanceChip) · .env.example + DEPLOYMENT.md (RELAYER_PRIVATE_KEY, GATEWAY_MINTER).

## Prereqs you provide (for live; simulate needs none)
- RELAYER_PRIVATE_KEY in the single `.env` (funded Arc EOA for mint+split gas).

## Execution order (working checkpoint first)
2a SIMULATE — ✅ DONE (built + verified: tsc clean, prod build OK, migration 0003 applied,
   sign→verify round-trip + split-math unit checks pass). Shipped:
   - migration 0003 (pay_sessions table + reserve_amount/pay_session_id on payment_ledger)
   - lib/split-payment.ts realigned to deployed contract 80/12/5/3 (folds 5%→reserve w/o referrer; +reserveAmount)
   - lib/burn-intent.ts (isomorphic: EIP-712 BurnIntent types verbatim, addressToBytes32, buildBurnIntent, paySessionAuthMessage)
   - lib/session-key.ts (jose JWT cookie linepay_pay_session) · lib/session-key-client.ts (local keypair, silent signTypedData)
   - lib/gateway-relayer.ts (verifyBurnIntent + relayerRecipient; submitBurnIntent/gatewayBalance ready for 2b)
   - store.ts: createPaySession/getActivePaySession/getPaySessionById/chargePaySession(atomic cap)/revokePaySession; reserve threaded through insertLedger
   - app/api/pay-session/{init,balance,revoke} · components/PaySetupModal + BalanceChip
   - reader route accepts {sessionPayment:{burnIntent,signature}} (verify cookie+intent, atomic cap charge, idempotent on salt; live path returns 501 + refunds cap until 2b)
   - ChunkReader: first unlock → setup modal (one signature); subsequent blocks silent; wallet path kept as "pay just this block" fallback; BalanceChip in header
2b LIVE — ✅ BUILT (tsc clean, prod build OK, relayer guards + key-derived recipient + sign→verify
   round-trip tested without funds). Shipped:
   - gateway-relayer.ts: lazy viem relayer (RELAYER_PRIVATE_KEY on Arc via defineChain), relayerRecipient()
     now derives from the key in live; submitBurnIntent (POST /v1/transfer), ensureRevenueSplitApproval
     (max-approve once), relayMint (gatewayMint(bytes,bytes) on Minter), splitOnChain (RevenueSplit.split),
     gatewayBalance (POST /v1/balances).
   - reader route live branch: charge cap → submitBurnIntent (refund cap on failure) → record ledger
     pending → return text immediately (optimistic) → next/server after(): ensureApproval + relayMint +
     splitOnChain(creatorWallet, referrerWallet, value) + finalizeLedgerByToken→completed + earning email.
     Burn failure leaves nothing charged; mint/split failure leaves row pending (burn recoverable via
     attestation). creator/referrer wallets resolved from DB at settle time.
   - PaySetupModal: when NEXT_PUBLIC_PAYMENTS_MODE=live, one-time on-chain stepper — switch→Arc,
     approve(USDC,gatewayWallet,cap) (skips if allowance ok), deposit(USDC,cap), addDelegate(USDC,sessionAddr),
     then sign auth + init. Simulate path unchanged. These are the ONLY popups.
   - balance route: best-effort on-chain gatewayBalance in live alongside DB cap/spent.
   - .env.example + DEPLOYMENT.md: REVENUE_SPLIT_ADDRESS, RELAYER_PRIVATE_KEY, RELAYER_ADDRESS,
     GATEWAY_MAX_FEE, NEXT_PUBLIC_PAYMENTS_MODE, NEXT_PUBLIC_GATEWAY_WALLET/MINTER_ADDRESS, ARC_GATEWAY_DOMAIN.
   KNOWN LIMITATION: settles one mint+split tx PER chunk (fine for demo; production would batch per-creator).
   Relayer needs test USDC float for Gateway fees + gas. To go live: set the env vars + fund the relayer &
   reader wallets at faucet.circle.com.

## Verify
- Unit: burn-intent struct/bytes32 padding, JWT sign/verify, cap enforcement, split 80/12/5/3.
- Manual: first unlock = setup popups only; chunks 2..N = zero popups; balance chip ticks down;
  low-bal toast; revoke. Live: on-chain mint + RevenueSplit.split tx on arcscan; ledger pending→completed.
- Don't break: existing per-block wallet path + agent x402 still work.
