"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/Toaster";
import { timeAgo } from "@/lib/time-ago";
import LikeButton from "@/components/motion/LikeButton";

// ─────────────────────────────────────────────────────────────────────────────
// Comments — rendered below the reader on a post page. Top-level comments with
// one level of light inline replies. Auth required to post; optimistic add on
// submit (reverted + toasted on error). Authors can delete their own comments.
// Likes, animated entry, icon action bar, and collapse-after-3 make it feel live.
// ─────────────────────────────────────────────────────────────────────────────

const MAX = 1000;
const PAGE = 20;
const VISIBLE_REPLIES = 3;

interface Author {
  id: string;
  name: string | null;
  handle: string | null;
  avatarUrl: string | null;
}

interface Comment {
  id: string;
  postId: string;
  parentId: string | null;
  content: string;
  createdAt: string;
  author: Author;
  replyCount: number;
  likeCount: number;
  liked: boolean;
}

export default function CommentsSection({ postId }: { postId: string }) {
  const { data: session, status } = useSession();
  const me = session?.user?.id ?? null;
  const toast = useToast();

  const [comments, setComments] = useState<Comment[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(1);

  const meAuthor: Author = {
    id: me ?? "",
    name: session?.user?.name ?? null,
    handle: session?.user?.handle ?? null,
    avatarUrl: session?.user?.image ?? null,
  };

  const load = useCallback(
    async (reset: boolean) => {
      const page = reset ? 1 : pageRef.current;
      setLoading(true);
      try {
        const r = await fetch(`/api/comments/${postId}?page=${page}&limit=${PAGE}`);
        const d = await r.json();
        const rows: Comment[] = d.comments ?? [];
        pageRef.current = page + 1;
        setHasMore(!!d.pagination?.hasMore);
        if (typeof d.pagination?.total === "number") setCount(d.pagination.total);
        setComments((prev) => (reset ? rows : [...prev, ...rows]));
      } catch {
        /* keep whatever we have */
      } finally {
        setLoading(false);
      }
    },
    [postId]
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const adjustCount = useCallback((delta: number) => setCount((c) => Math.max(0, c + delta)), []);

  const addComment = useCallback(
    async (content: string) => {
      const tempId = `temp-${Date.now()}`;
      const optimistic: Comment = {
        id: tempId,
        postId,
        parentId: null,
        content,
        createdAt: new Date().toISOString(),
        author: meAuthor,
        replyCount: 0,
        likeCount: 0,
        liked: false,
      };
      setComments((prev) => [optimistic, ...prev]);
      setCount((c) => c + 1);
      try {
        const r = await fetch(`/api/comments/${postId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        setComments((prev) => prev.map((c) => (c.id === tempId ? d.comment : c)));
      } catch (e) {
        setComments((prev) => prev.filter((c) => c.id !== tempId));
        setCount((c) => Math.max(0, c - 1));
        toast("error", "Couldn't post your comment. Try again.");
        throw e;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [postId, session, toast]
  );

  const deleteTopLevel = useCallback(
    async (c: Comment) => {
      const snapshot = comments;
      setComments((prev) => prev.filter((x) => x.id !== c.id));
      setCount((n) => Math.max(0, n - 1 - c.replyCount));
      try {
        const r = await fetch(`/api/comments/${c.id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(String(r.status));
      } catch {
        setComments(snapshot);
        setCount((n) => n + 1 + c.replyCount);
        toast("error", "Couldn't delete the comment.");
      }
    },
    [comments, toast]
  );

  const authed = status === "authenticated";

  return (
    <section className="mx-auto mt-12 max-w-3xl px-margin-mobile pb-24 md:px-margin-desktop">
      <h2 className="mb-5 font-headline-sm text-headline-sm">comments ({count})</h2>

      {/* Composer (or sign-in prompt). */}
      {authed ? (
        <div className="flex gap-3">
          <Avatar author={meAuthor} />
          <div className="min-w-0 flex-1">
            <Composer onSubmit={addComment} placeholder="Add your take…" />
          </div>
        </div>
      ) : status === "loading" ? null : (
        <p className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3 font-body-sm text-body-sm text-on-surface-variant">
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>{" "}
          to comment.
        </p>
      )}

      {/* List. */}
      <div className="mt-6 flex flex-col gap-6">
        {loading && comments.length === 0 && (
          <p className="font-body-sm text-on-surface-variant">Loading comments…</p>
        )}
        {!loading && comments.length === 0 && (
          <p className="font-body-sm text-on-surface-variant">
            {authed ? "Be the first to reply." : "No comments yet."}
          </p>
        )}
        <AnimatePresence initial={false}>
          {comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              me={me}
              meAuthor={meAuthor}
              authed={authed}
              onDelete={() => deleteTopLevel(c)}
              onReplyCountDelta={adjustCount}
            />
          ))}
        </AnimatePresence>
      </div>

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => load(false)}
            disabled={loading}
            className="rounded-full border border-outline-variant px-4 py-1.5 font-label-caps text-label-caps text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            {loading ? "Loading…" : "Load more comments"}
          </button>
        </div>
      )}
    </section>
  );
}

function CommentItem({
  comment,
  me,
  meAuthor,
  authed,
  onDelete,
  onReplyCountDelta,
}: {
  comment: Comment;
  me: string | null;
  meAuthor: Author;
  authed: boolean;
  onDelete: () => void;
  onReplyCountDelta: (delta: number) => void;
}) {
  const toast = useToast();
  const isTemp = comment.id.startsWith("temp-");
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [replies, setReplies] = useState<Comment[]>([]);
  const [repliesLoaded, setRepliesLoaded] = useState(false);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [replyCount, setReplyCount] = useState(comment.replyCount);
  const [replying, setReplying] = useState(false);

  const loadReplies = useCallback(async () => {
    setLoadingReplies(true);
    try {
      const r = await fetch(`/api/comments/${comment.postId}/replies/${comment.id}`);
      const d = await r.json();
      setReplies(d.replies ?? []);
      setRepliesLoaded(true);
    } catch {
      /* ignore */
    } finally {
      setLoadingReplies(false);
    }
  }, [comment.postId, comment.id]);

  const toggleReplies = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    if (next && !repliesLoaded) void loadReplies();
  }, [expanded, repliesLoaded, loadReplies]);

  const addReply = useCallback(
    async (content: string) => {
      const tempId = `temp-r-${Date.now()}`;
      const optimistic: Comment = {
        id: tempId,
        postId: comment.postId,
        parentId: comment.id,
        content,
        createdAt: new Date().toISOString(),
        author: meAuthor,
        replyCount: 0,
        likeCount: 0,
        liked: false,
      };
      setReplies((prev) => [...prev, optimistic]);
      setReplyCount((n) => n + 1);
      onReplyCountDelta(1);
      try {
        const r = await fetch(`/api/comments/${comment.postId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content, parentId: comment.id }),
        });
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        setReplies((prev) => prev.map((x) => (x.id === tempId ? d.comment : x)));
      } catch (e) {
        setReplies((prev) => prev.filter((x) => x.id !== tempId));
        setReplyCount((n) => Math.max(0, n - 1));
        onReplyCountDelta(-1);
        toast("error", "Couldn't post your reply. Try again.");
        throw e;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comment.postId, comment.id, meAuthor, onReplyCountDelta, toast]
  );

  const deleteReply = useCallback(
    async (reply: Comment) => {
      const snapshot = replies;
      setReplies((prev) => prev.filter((x) => x.id !== reply.id));
      setReplyCount((n) => Math.max(0, n - 1));
      onReplyCountDelta(-1);
      try {
        const r = await fetch(`/api/comments/${reply.id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(String(r.status));
      } catch {
        setReplies(snapshot);
        setReplyCount((n) => n + 1);
        onReplyCountDelta(1);
        toast("error", "Couldn't delete the reply.");
      }
    },
    [replies, onReplyCountDelta, toast]
  );

  const shownReplies = showAll ? replies : replies.slice(0, VISIBLE_REPLIES);
  const hiddenReplies = replies.length - shownReplies.length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <CommentBody comment={comment} canDelete={!isTemp && me === comment.author.id} onDelete={onDelete}>
        <div className="mt-1 flex items-center gap-4">
          <LikeButton kind="comment" id={comment.id} initialLiked={comment.liked} initialCount={comment.likeCount} size="sm" />
          {authed && !isTemp && (
            <ActionButton icon="reply" label="reply" onClick={() => setReplying((v) => !v)} />
          )}
          {replyCount > 0 && (
            <button
              onClick={toggleReplies}
              className="font-label-caps text-label-caps text-on-surface-variant hover:text-primary"
            >
              {expanded ? "hide" : `${replyCount} repl${replyCount === 1 ? "y" : "ies"}`}
            </button>
          )}
        </div>
      </CommentBody>

      {(expanded || replying) && (
        <div className="ml-4 mt-3 flex flex-col gap-4 border-l-2 border-outline-variant/60 pl-4">
          {loadingReplies && <p className="font-body-sm text-[13px] text-on-surface-variant">Loading replies…</p>}
          <AnimatePresence initial={false}>
            {shownReplies.map((r) => (
              <motion.div
                key={r.id}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <CommentBody comment={r} canDelete={!r.id.startsWith("temp-") && me === r.author.id} onDelete={() => deleteReply(r)}>
                  <div className="mt-1">
                    <LikeButton kind="comment" id={r.id} initialLiked={r.liked} initialCount={r.likeCount} size="sm" />
                  </div>
                </CommentBody>
              </motion.div>
            ))}
          </AnimatePresence>

          {hiddenReplies > 0 && (
            <button
              onClick={() => setShowAll(true)}
              className="self-start font-label-caps text-label-caps text-primary hover:underline"
            >
              Show {hiddenReplies} more repl{hiddenReplies === 1 ? "y" : "ies"}
            </button>
          )}

          {replying && authed && (
            <Composer
              compact
              autoFocus
              placeholder={`Reply to ${comment.author.name ?? comment.author.handle ?? "this comment"}…`}
              onSubmit={async (v) => {
                await addReply(v);
                if (!expanded) setExpanded(true);
                setReplying(false);
              }}
            />
          )}
        </div>
      )}
    </motion.div>
  );
}

function CommentBody({
  comment,
  canDelete,
  onDelete,
  children,
}: {
  comment: Comment;
  canDelete: boolean;
  onDelete: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Avatar author={comment.author} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/creator/${comment.author.id}`} className="flex items-baseline gap-1.5 hover:opacity-90">
            <span className="font-body-sm text-[14px] font-semibold text-on-surface">
              {comment.author.name ?? comment.author.handle ?? "User"}
            </span>
            {comment.author.handle && (
              <span className="font-data-mono text-[12px] text-outline">@{comment.author.handle}</span>
            )}
          </Link>
          <span className="font-body-sm text-[12px] text-outline">· {timeAgo(comment.createdAt)}</span>
          {canDelete && (
            <button
              onClick={onDelete}
              title="Delete"
              aria-label="Delete comment"
              className="group/del ml-auto inline-flex items-center text-outline transition-colors hover:text-primary"
            >
              <span className="material-symbols-outlined text-[16px]">delete</span>
            </button>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words font-body-md text-body-md text-on-surface">
          {comment.content}
        </p>
        {children}
      </div>
    </div>
  );
}

/** Icon action with a label that expands on hover (keeps the row uncluttered). */
function ActionButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="group/act inline-flex items-center gap-1 text-on-surface-variant transition-colors hover:text-primary"
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      <span className="max-w-0 overflow-hidden whitespace-nowrap font-label-caps text-label-caps opacity-0 transition-all duration-150 group-hover/act:max-w-[64px] group-hover/act:opacity-100">
        {label}
      </span>
    </button>
  );
}

function Avatar({ author, size = "md" }: { author: Author; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-8 w-8" : "h-9 w-9";
  if (author.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={author.avatarUrl} alt="" className={`${dim} shrink-0 rounded-full object-cover`} />;
  }
  const initial = (author.name ?? author.handle ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`${dim} flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-label-caps text-[12px] text-primary`}
    >
      {initial}
    </span>
  );
}

function Composer({
  onSubmit,
  placeholder,
  compact = false,
  autoFocus = false,
}: {
  onSubmit: (value: string) => Promise<void>;
  placeholder: string;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const v = value.trim();
    if (!v || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(v);
      setValue("");
    } catch {
      /* onSubmit toasted; keep the text so the user can retry */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, MAX))}
        onKeyDown={(e) => {
          // Enter submits; Shift+Enter (or empty) inserts a newline.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        maxLength={MAX}
        rows={compact ? 2 : 3}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="w-full resize-y rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <span className="font-data-mono text-[12px] text-outline">
          {value.length} / {MAX}
        </span>
        <button
          onClick={submit}
          disabled={!value.trim() || submitting}
          className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-1.5 font-label-caps text-label-caps text-on-primary transition-transform hover:bg-primary/90 active:scale-[0.97] disabled:opacity-60"
        >
          {submitting && <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>}
          {compact ? "Reply" : "Post"}
        </button>
      </div>
    </div>
  );
}
