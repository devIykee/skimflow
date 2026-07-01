-- Engagement: post likes and comment likes.
--
-- Adds two directed like edges so the social UI can show reaction counts and
-- optimistic like/unlike on posts (content) and comments. Mirrors the follows
-- table conventions from 0013 (uuid pk, timestamptz default now(), unique edge,
-- cascade deletes). "Posts" are `content` rows.

-- A user likes a piece of content. One like per (user, post).
CREATE TABLE IF NOT EXISTS post_likes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  post_id    UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS post_likes_post_idx ON post_likes (post_id);
CREATE INDEX IF NOT EXISTS post_likes_user_idx ON post_likes (user_id);

-- A user likes a comment. One like per (user, comment).
CREATE TABLE IF NOT EXISTS comment_likes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, comment_id)
);
CREATE INDEX IF NOT EXISTS comment_likes_comment_idx ON comment_likes (comment_id);
CREATE INDEX IF NOT EXISTS comment_likes_user_idx    ON comment_likes (user_id);
