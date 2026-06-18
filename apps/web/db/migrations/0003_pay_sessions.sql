-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2 — session-key silent payments.
--
-- A pay_session records ONE delegate authorization: the reader signs once (in
-- their main wallet) to deposit USDC into Circle Gateway and add a local
-- session key as a delegate with a spend cap. After that, every chunk is paid
-- by silently signing a BurnIntent with the session key (no wallet popup). The
-- server tallies `spent` against `cap` so a leaked session key can never drain
-- more than the authorized amount.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pay_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  main_wallet     TEXT NOT NULL,                 -- depositor / Gateway balance owner (EIP-55)
  session_address TEXT NOT NULL,                 -- local delegate key (signs burn intents)
  cap             NUMERIC(18,6) NOT NULL,        -- max total USDC this session may spend
  spent           NUMERIC(18,6) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active', -- 'active' | 'revoked' | 'expired'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS pay_sessions_wallet_idx ON pay_sessions (main_wallet);
-- At most one active session per delegate address (re-init revokes the old one).
CREATE UNIQUE INDEX IF NOT EXISTS pay_sessions_active_addr_uidx
  ON pay_sessions (session_address) WHERE status = 'active';

-- Reserve share of each payment (aligns the off-chain ledger to the deployed
-- RevenueSplit 80/12/5/3 contract, where 3% — plus any folded/absorbed leg —
-- accrues to an owner-drainable reserve).
ALTER TABLE payment_ledger ADD COLUMN IF NOT EXISTS reserve_amount NUMERIC(18,6) NOT NULL DEFAULT 0;

-- Which pay_session (if any) settled this row — null for direct-wallet/agent pays.
ALTER TABLE payment_ledger ADD COLUMN IF NOT EXISTS pay_session_id UUID REFERENCES pay_sessions(id) ON DELETE SET NULL;
