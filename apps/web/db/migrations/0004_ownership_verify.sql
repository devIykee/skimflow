-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5 — content import ownership verification.
--
-- A creator can import an article/skill from X, GitHub, Substack or Medium, then
-- PROVE they own the source:
--   • GitHub   → the repo owner matches their GitHub OAuth username.
--   • X / Substack / Medium → they paste a one-time verify code in their profile
--     bio; we fetch the public profile and confirm the code is present.
-- Verified pieces carry a "Source verified ✓" badge.
-- ─────────────────────────────────────────────────────────────────────────────

-- GitHub login captured at OAuth sign-in; per-user code for bio verification.
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_code TEXT;

-- Where a piece was imported from + whether ownership was proven.
ALTER TABLE content ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE content ADD COLUMN IF NOT EXISTS source_platform TEXT;          -- 'github' | 'x' | 'substack' | 'medium' | 'other'
ALTER TABLE content ADD COLUMN IF NOT EXISTS ownership_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE content ADD COLUMN IF NOT EXISTS verified_via TEXT;             -- 'github_oauth' | 'bio_code'
