-- ─────────────────────────────────────────────────────────────────────────────
-- Settlement recovery. Live silent payments submit the Gateway burn (debiting
-- the unified balance) and then mint→split in a background task; if that task
-- fails the row is deliberately left `pending`. Persisting the Gateway
-- attestation + burn signature (and the mint tx once it lands) lets an admin
-- retry the mint→split without re-burning — see /api/admin/payments/[token]/settle.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE payment_ledger ADD COLUMN IF NOT EXISTS attestation     TEXT;
ALTER TABLE payment_ledger ADD COLUMN IF NOT EXISTS burn_signature  TEXT;
ALTER TABLE payment_ledger ADD COLUMN IF NOT EXISTS mint_tx         TEXT;
