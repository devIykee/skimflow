-- ─────────────────────────────────────────────────────────────────────────────
-- Embedded (Circle User-Controlled) wallets. Every non-admin user gets one
-- auto-provisioned wallet they custody via PIN/social login. `wallet_address`
-- stays the single payout source of truth; `wallet_source` records whether that
-- active payout points at the embedded wallet or an externally-connected one.
-- Admins are NEVER provisioned an embedded wallet (they sign with an external
-- wallet), so these columns stay NULL / 'external' for them.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS embedded_wallet_id      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS embedded_wallet_address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_source           TEXT NOT NULL DEFAULT 'external';
