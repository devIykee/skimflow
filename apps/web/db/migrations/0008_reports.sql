-- Reports inbox (admin moderation surface) + retire the x-post content type.
--
-- Reports come from two flows:
--   broken_link    — a paid image's link is dead AFTER settlement (§5b). Carries
--                    the content/block and the amount the reader paid.
--   content_report — a user "Report this post" on any content (§2c): copyright,
--                    scam, inappropriate, etc.
-- Creator removal of paid content (§5d) also files a content_report with a
-- distinguishing reason so there's an audit trail.

CREATE TABLE IF NOT EXISTS reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type    TEXT NOT NULL,                         -- 'broken_link' | 'content_report'
  reason         TEXT,                                  -- copyright | scam | inappropriate | broken_link | creator_removed_paid | other
  detail         TEXT,                                  -- free-text from the reporter
  content_id     UUID REFERENCES content(id) ON DELETE SET NULL,
  block_index    INTEGER,                               -- image/chunk index for broken_link
  creator_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  reporter_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  reporter_label TEXT,                                  -- wallet/anon label when no account
  amount_paid    NUMERIC(18,6),                         -- what the reader paid (broken_link)
  status         TEXT NOT NULL DEFAULT 'open',          -- open | reviewed | resolved | dismissed
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reports_status_idx  ON reports (status);
CREATE INDEX IF NOT EXISTS reports_created_idx ON reports (created_at DESC);
CREATE INDEX IF NOT EXISTS reports_content_idx ON reports (content_id);

-- Retire x-post: existing posts become plain articles (they're already chunked,
-- so they render fine as articles). The 'picture' Skim-Flow type replaces the
-- creator-facing post option going forward.
UPDATE content SET content_type = 'article' WHERE content_type = 'x-post';
