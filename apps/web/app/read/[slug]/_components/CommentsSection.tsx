"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/Toaster";
import { timeAgo } from "@/lib/time-ago";

// ─────────────────────────────────────────────────────────────────────────────
// Comments — rendered below the reader on a post page. Top-level comments with
// one level of inline replies. Auth required to post; optimistic add on submit
// (reverted + toasted on error). Authors can delete their own comments.
// ─────────────────────────────────────────────────────────────────────────────

const MAX = 1000;
const PAGE = 20;

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
        /* leave whatever we have */
      } finally {
        setLoading(false);
      }
    },
    [postId]
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  /** Bubble a total-count delta up from reply add/delete. */
  const adjustCount = useCallback((delta: number) => setCount((c) => Math.max(0, c + delta)), []);

  const addComment = useCallback(
    async (content: string) => {
      const tempId = `temp-${pageRef.current}-${content.length}-${Math.round(performance.now())}`;
      const optimistic: Comment = {
        id: tempId,
        postId,
        parentId: null,
        content,
        createdAt: new Date().toISOString(),
        author: meAuthor,
        replyCount: 0,
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
        throw e; // keep the composer text
      }
    },
    // meAuthor is derived from session each render; depending on session is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [postId, session, toast]
  );

  const deleteTopLevel = useCallback(
    async (c: Comment) => {
      const snapshot = comments;
      setComments((prev) => prev.filter((x) => x.id !== c.id));
      setCount((n) => Math.max(0, n - 1 - c.replyCount)); // replies cascade
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

  return (
    <section className="mx-auto mt-12 max-w-3xl px-margin-mobile pb-24 md:px-margin-desktop">
      <h2 className="mb-5 font-headline-sm text-headline-sm">comments ({count})</h2>

      {/* Composer (or sign-in prompt). */}
      {status === "authenticated" ? (
        <Composer onSubmit={addComment} placeholder="Add a comment…" />
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
          <p className="font-body-sm text-on-surface-variant">No comments yet. Be the first.</p>
        )}
        {comments.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            me={me}
            meAuthor={meAuthor}
            authed={status === "authenticated"}
            onDelete={() => deleteTopLevel(c)}
            onReplyCountDelta={adjustCount}
          />
        ))}
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
      /* keep collapsed-ish */
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
      const tempId = `temp-r-${Math.round(performance.now())}`;
      const optimistic: Comment = {
        id: tempId,
        postId: comment.postId,
        parentId: comment.id,
        content,
        createdAt: new Date().toISOString(),
        author: meAuthor,
        replyCount: 0,
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

  return (
    <div>
      <CommentBody
        comment={comment}
        canDelete={!isTemp && me === comment.author.id}
        onDelete={onDelete}
      >
        {/* Actions */}
        <div className="mt-1 flex items-center gap-4">
          {authed && !isTemp && (
            <button
              onClick={() => setReplying((v) => !v)}
              className="font-label-caps text-label-caps text-on-surface-variant hover:text-primary"
            >
              reply
            </button>
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
        <div className="ml-4 mt-3 flex flex-col gap-4 border-l border-outline-variant pl-4">
          {loadingReplies && <p className="font-body-sm text-[13px] text-on-surface-variant">Loading replies…</p>}
          {replies.map((r) => (
            <CommentBody
              key={r.id}
              comment={r}
              canDelete={!r.id.startsWith("temp-") && me === r.author.id}
              onDelete={() => deleteReply(r)}
            />
          ))}

          {/* Reply composer at the bottom of the expanded thread. */}
          {replying && authed && (
            <Composer
              compact
              autoFocus
              placeholder="Write a reply…"
              onSubmit={async (v) => {
                await addReply(v);
                if (!expanded) setExpanded(true);
                setReplying(false);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Avatar + author line + content, with an optional delete button + children (actions). */
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
  const a = comment.author;
  return (
    <div className="flex gap-3">
      {a.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={a.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-label-caps text-[12px] text-primary">
          {(a.name ?? a.handle ?? "?").trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/creator/${a.id}`} className="flex items-baseline gap-1.5 hover:opacity-90">
            <span className="font-body-sm text-[14px] font-semibold text-on-surface">
              {a.name ?? a.handle ?? "User"}
            </span>
            {a.handle && <span className="font-data-mono text-[12px] text-outline">@{a.handle}</span>}
          </Link>
          <span className="font-body-sm text-[12px] text-outline">· {timeAgo(comment.createdAt)}</span>
          {canDelete && (
            <button
              onClick={onDelete}
              title="Delete"
              className="ml-auto font-label-caps text-label-caps text-outline transition-colors hover:text-primary"
            >
              delete
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
      setValue(""); // cleared only on success
    } catch {
      /* onSubmit already toasted; keep the text so the user can retry */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, MAX))}
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
          className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-1.5 font-label-caps text-label-caps text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {submitting && <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>}
          {compact ? "Reply" : "Post"}
        </button>
      </div>
    </div>
  );
}
