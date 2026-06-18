-- ─────────────────────────────────────────────────────────────────────────────
-- Profile settings — creators replace their auto-generated handle/name and add
-- a short bio. Length is enforced in the app (display_name ≤32, handle ≤24,
-- bio ≤160) so cards never break.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
