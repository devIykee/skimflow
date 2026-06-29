-- Social features: follows, comments, and social notifications.
--
-- Skimflow gains a lightweight social layer on top of the pay-per-block content
-- model:
--   • follows   — directed follower → following edges between users.
--   • comments  — threaded discussion on a piece of content (one level of
--                 nesting: top-level comments + their direct replies).
--   • notifications (EXTENDED) — the existing in-app notifications table (added
--                 in 0012 for Ghost imports) gains actor/post/comment columns so
--                 it can also carry social events (new_follower, post_comment,
--                 comment_reply) under one unified bell + unread count.
--
-- NB: there is no `posts` table — user-authored content lives in `content`,
-- keyed by `creator_id`. comments.post_id and notifications.post_id therefore
-- reference content(id), and a "post author" is content.creator_id.

-- ── Follows ─────────────────────────────────────────────────────────────────
-- A directed edge: `follower_id` follows `following_id`. The (follower,
-- following) pair is unique. Self-follows are blocked at the API layer (not a
-- DB constraint), matching the spec.
CREATE TABLE IF NOT EXISTS follows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (follower_id, following_id)
);
CREATE INDEX IF NOT EXISTS follows_follower_idx  ON follows (follower_id);
CREATE INDEX IF NOT EXISTS follows_following_idx ON follows (following_id);

-- ── Comments ────────────────────────────────────────────────────────────────
-- Threaded one level deep: a top-level comment has parent_id IS NULL; a reply
-- points its parent_id at a top-level comment. Replying to a reply is rejected
-- at the API + store layer (no DB-level depth constraint).
CREATE TABLE IF NOT EXISTS comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES content(id)  ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  parent_id  UUID          REFERENCES comments(id) ON DELETE CASCADE,  -- NULL = top-level
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS comments_post_idx   ON comments (post_id);
CREATE INDEX IF NOT EXISTS comments_user_idx   ON comments (user_id);
CREATE INDEX IF NOT EXISTS comments_parent_idx ON comments (parent_id);

-- ── Notifications (extend the 0012 table) ───────────────────────────────────
-- The original table carried Ghost-import notices (title/body/link). Social
-- notifications instead reference an actor (who triggered it) and optionally a
-- post and/or comment; the recipient-facing text is rendered client-side from
-- those refs, so `title` becomes nullable. All new columns are nullable so
-- existing Ghost rows remain valid.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id   UUID REFERENCES users(id)    ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS post_id    UUID REFERENCES content(id)  ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS comment_id UUID REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE notifications ALTER COLUMN title DROP NOT NULL;

-- The 0012 index `notifications_user_idx ON (user_id, read, created_at DESC)`
-- already serves both per-user listing and the unread-count query, so no new
-- index is needed here.
