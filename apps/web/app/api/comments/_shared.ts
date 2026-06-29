// Shared helpers for the comment routes. The leading underscore opts this file
// out of Next.js routing (it's not a `route.ts`), so it's import-only.
import type { CommentWithAuthor } from "@/lib/store";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Client-facing shape for a comment (top-level or reply). */
export function serializeComment(c: CommentWithAuthor) {
  return {
    id: c.id,
    postId: c.post_id,
    parentId: c.parent_id,
    content: c.content,
    createdAt: new Date(c.created_at).toISOString(),
    author: {
      id: c.user_id,
      name: c.author_name,
      handle: c.author_handle,
      avatarUrl: c.author_avatar,
    },
    replyCount: c.reply_count ?? 0,
  };
}
