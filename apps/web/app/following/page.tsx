"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { formatUsdc } from "@/lib/money";
import { timeAgo } from "@/lib/time-ago";
import LikeButton from "@/components/motion/LikeButton";
import QuickComposer from "@/components/composer/QuickComposer";
import ComposerFab from "@/components/composer/ComposerFab";
import SuggestedCreators from "@/components/SuggestedCreators";
import type { ComposerCallbacks, CreatedContent, OptimisticPost } from "@/components/composer/ComposerForm";

// ─────────────────────────────────────────────────────────────────────────────
// "Following" — a strictly-chronological timeline of posts from creators you
// follow. Single 680px column (not the For You grid). Infinite scroll, mirroring
// the For You fetch pattern. Empty state surfaces suggested creators to follow.
// ─────────────────────────────────────────────────────────────────────────────

interface FeedPost {
  id: string;
  slug: string;
  title: string;
  summary: string;
  contentType: string;
  pricePerBlock: string;
  blockCount?: number;
  coverImageUrl?: string | null;
  creatorId: string;
  creatorHandle: string | null;
  creatorName: string | null;
  creatorAvatar?: string | null;
  creatorVerified?: boolean;
  publishedAt: string;
  url: string;
  likeCount?: number;
  commentCount?: number;
  liked?: boolean;
}

const SEEN_KEY = "skimflow:following:seen";

interface Suggestion {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  bio: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  article: "Article",
  book: "Book",
  "agent-skills": "Agent Skills",
  picture: "Skimflow",
};

const PAGE = 20;

export default function FollowingPage() {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [newCount, setNewCount] = useState(0);

  const pageRef = useRef(1);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Baseline of post ids seen before this session — drives the "unread" dot.
  const seenRef = useRef<Set<string>>(new Set());

  const fetchPage = useCallback(async (reset: boolean) => {
    if (loadingRef.current) return;
    if (!reset && !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const page = reset ? 1 : pageRef.current;
    try {
      const res = await fetch(`/api/follows/feed?page=${page}&limit=${PAGE}`);
      if (res.status === 401) {
        setAuthError(true);
        hasMoreRef.current = false;
        setHasMore(false);
        return;
      }
      const data = await res.json();
      const rows: FeedPost[] = data.posts ?? [];
      const more = !!data.pagination?.hasMore;
      pageRef.current = page + 1;
      hasMoreRef.current = more;
      setHasMore(more);
      setPosts((prev) => (reset ? rows : [...prev, ...rows]));
      if (Array.isArray(data.suggestions)) setSuggestions(data.suggestions);
    } catch {
      hasMoreRef.current = false;
      setHasMore(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void fetchPage(true);
  }, [fetchPage]);

  // Infinite scroll.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void fetchPage(false);
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [fetchPage]);

  // Load the "seen" baseline once (unread dots compare against it this session).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      if (raw) seenRef.current = new Set(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
  }, []);

  // Persist loaded ids so they read as "seen" next visit. The in-memory baseline
  // stays fixed so this session's dots don't disappear as you scroll.
  useEffect(() => {
    if (posts.length === 0) return;
    try {
      const merged = new Set<string>(seenRef.current);
      for (const p of posts) if (!p.id.startsWith("temp-")) merged.add(p.id);
      localStorage.setItem(SEEN_KEY, JSON.stringify([...merged].slice(-500)));
    } catch {
      /* ignore */
    }
  }, [posts]);

  // Poll the feed head every 20s; surface a "N new posts" pill rather than
  // silently inserting them (a proven engagement trigger).
  useEffect(() => {
    const check = async () => {
      if (document.hidden || authError) return;
      try {
        const res = await fetch(`/api/follows/feed?page=1&limit=5`);
        if (!res.ok) return;
        const data = await res.json();
        const have = new Set(posts.map((p) => p.id));
        const fresh = (data.posts ?? []).filter((p: FeedPost) => !have.has(p.id)).length;
        setNewCount(fresh);
      } catch {
        /* ignore */
      }
    };
    const iv = setInterval(check, 20_000);
    return () => clearInterval(iv);
  }, [posts, authError]);

  const reload = useCallback(() => {
    pageRef.current = 1;
    hasMoreRef.current = true;
    setHasMore(true);
    setNewCount(0);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    void fetchPage(true);
  }, [fetchPage]);

  // Optimistic composer wiring: prepend on submit, swap in the real row on
  // success, remove on failure.
  const composerCallbacks: ComposerCallbacks = useMemo(() => {
    const clearPending = (tempId: string) =>
      setPendingIds((prev) => {
        const n = new Set(prev);
        n.delete(tempId);
        return n;
      });
    return {
      onPending: (t: OptimisticPost) => {
        const post: FeedPost = {
          id: t.tempId,
          slug: "",
          title: t.title,
          summary: t.summary,
          contentType: "article",
          pricePerBlock: "0",
          blockCount: 0,
          creatorId: t.author.id,
          creatorHandle: t.author.handle,
          creatorName: t.author.name,
          creatorAvatar: t.author.avatarUrl,
          publishedAt: t.createdAt,
          url: "#",
        };
        setPendingIds((prev) => new Set(prev).add(t.tempId));
        setPosts((prev) => [post, ...prev]);
        setAuthError(false);
      },
      onSuccess: (tempId: string, c: CreatedContent) => {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === tempId
              ? {
                  ...p,
                  id: c.id,
                  slug: c.slug,
                  title: c.title,
                  summary: c.summary,
                  contentType: c.content_type,
                  pricePerBlock: c.price_per_block,
                  blockCount: c.block_count,
                  publishedAt: c.published_at ?? c.created_at,
                  url: `/read/${c.slug}`,
                }
              : p
          )
        );
        clearPending(tempId);
      },
      onError: (tempId: string) => {
        setPosts((prev) => prev.filter((p) => p.id !== tempId));
        clearPending(tempId);
      },
    };
  }, []);

  return (
    <div className="mx-auto max-w-[680px] px-margin-mobile py-stack-lg md:px-margin-desktop">
      <header className="mb-6">
        <h1 className="mb-1 font-display-lg text-display-lg-mobile md:text-display-lg">Following</h1>
        <p className="font-body-md text-body-md text-on-surface-variant">
          The latest from creators you follow, newest first.
        </p>
      </header>

      {/* Frictionless composer: sticky on desktop, FAB on mobile. */}
      <QuickComposer surface="following" callbacks={composerCallbacks} />
      <ComposerFab surface="following" callbacks={composerCallbacks} />

      {/* New-posts pill. */}
      <AnimatePresence>
        {newCount > 0 && (
          <motion.button
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            onClick={reload}
            className="sticky top-[132px] z-20 mx-auto mb-4 flex items-center gap-1 rounded-full bg-primary px-4 py-1.5 font-label-caps text-label-caps text-on-primary shadow-md md:top-[140px]"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
            {newCount >= 5 ? "5+ new posts" : `${newCount} new post${newCount === 1 ? "" : "s"}`}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Initial loading → skeletons. */}
      {loading && posts.length === 0 && !authError && (
        <div className="flex flex-col gap-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* Signed out. */}
      {authError && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center">
          <p className="mb-3 font-body-md text-on-surface-variant">Sign in to see your following feed.</p>
          <Link href="/login" className="inline-flex rounded-full bg-primary px-4 py-1.5 font-label-caps text-label-caps text-on-primary">
            Sign in
          </Link>
        </div>
      )}

      {/* Empty feed → suggestions. */}
      {!loading && !authError && posts.length === 0 && (
        <EmptyState suggestions={suggestions} onFollow={reload} />
      )}

      {/* Timeline. */}
      {posts.length > 0 && (
        <div className="flex flex-col gap-5">
          <AnimatePresence initial={false}>
            {posts.map((p) => (
              <PostCard
                key={p.id}
                p={p}
                pending={pendingIds.has(p.id)}
                unseen={!p.id.startsWith("temp-") && !seenRef.current.has(p.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Infinite-scroll sentinel + footer status. */}
      <div ref={sentinelRef} aria-hidden className="h-px" />
      {loading && posts.length > 0 && (
        <p className="mt-6 text-center font-body-sm text-on-surface-variant">Loading more…</p>
      )}
      {!hasMore && posts.length > 0 && (
        <p className="mt-6 text-center font-body-sm text-outline">You&apos;re all caught up.</p>
      )}
    </div>
  );
}

function PostCard({ p, pending = false, unseen = false }: { p: FeedPost; pending?: boolean; unseen?: boolean }) {
  const paid = (p.blockCount ?? 0) > 0;
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={`card flex flex-col gap-3 p-5 ${pending ? "animate-pulse" : ""} ${
        unseen ? "border-primary/30" : ""
      }`}
    >
      {/* Creator row. */}
      <div className="flex items-center gap-2">
        {unseen && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="New" />}
        <Link href={`/creator/${p.creatorId}`} className="flex items-center gap-2 hover:opacity-90">
          <Avatar name={p.creatorName ?? p.creatorHandle} src={p.creatorAvatar} />
          <span className="flex items-baseline gap-1.5">
            <span className={`font-body-sm text-[14px] text-on-surface ${unseen ? "font-bold" : "font-semibold"}`}>
              {p.creatorName ?? p.creatorHandle ?? "Creator"}
            </span>
            {p.creatorHandle && (
              <span className="font-data-mono text-[12px] text-outline">@{p.creatorHandle}</span>
            )}
          </span>
        </Link>
        <span className="font-body-sm text-[12px] text-outline">
          · {pending ? "posting…" : timeAgo(p.publishedAt)}
        </span>
      </div>

      {/* Title + teaser. */}
      <Link href={p.url} className="group flex flex-col gap-2">
        <h2 className="font-headline-sm text-headline-sm font-semibold leading-tight group-hover:text-primary">
          {p.title}
        </h2>
        {p.summary && (
          <p className="line-clamp-3 font-body-md text-body-md text-on-surface-variant">{p.summary}</p>
        )}
      </Link>

      {/* Engagement + footer. */}
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-outline-variant/60 pt-3">
        <div className="flex items-center gap-4">
          <span className="pill">{TYPE_LABEL[p.contentType] ?? p.contentType}</span>
          {!pending && (
            <>
              <LikeButton kind="post" id={p.id} initialLiked={!!p.liked} initialCount={p.likeCount ?? 0} size="sm" />
              <Link
                href={p.url}
                className="inline-flex items-center gap-1 text-on-surface-variant transition-colors hover:text-primary"
                aria-label="Comments"
              >
                <span className="material-symbols-outlined text-[18px]">chat_bubble</span>
                {(p.commentCount ?? 0) > 0 && <span className="font-body-sm text-[12px]">{p.commentCount}</span>}
              </Link>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={`font-data-mono text-[12px] ${paid ? "text-secondary" : "text-on-surface-variant"}`}>
            {paid ? `from ${formatUsdc(p.pricePerBlock)} USDC` : "Free"}
          </span>
          <Link href={p.url} className="font-label-caps text-label-caps text-primary hover:underline">
            Read →
          </Link>
        </div>
      </div>
    </motion.article>
  );
}

function EmptyState({ suggestions, onFollow }: { suggestions: Suggestion[]; onFollow: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-8 text-center">
      <div>
        <h2 className="mb-1 font-headline-sm text-headline-sm">your following feed is empty</h2>
        <p className="font-body-md text-body-md text-on-surface-variant">
          follow some creators to see their posts here
        </p>
      </div>

      {suggestions.length > 0 && (
        <div className="w-full text-left">
          <SuggestedCreators creators={suggestions} onFollowed={onFollow} />
        </div>
      )}

      <Link href="/for-you" className="font-label-caps text-label-caps text-primary hover:underline">
        Discover more on For You →
      </Link>
    </div>
  );
}

function Avatar({ name, src, dim = "h-7 w-7" }: { name: string | null; src?: string | null; dim?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={`${dim} shrink-0 rounded-full object-cover`} />;
  }
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`${dim} flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-label-caps text-[12px] text-primary`}
    >
      {initial}
    </span>
  );
}

function SkeletonCard() {
  return (
    <div className="card flex animate-pulse flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-full bg-surface-container-high" />
        <div className="h-3 w-32 rounded bg-surface-container-high" />
      </div>
      <div className="h-5 w-3/4 rounded bg-surface-container-high" />
      <div className="h-4 w-full rounded bg-surface-container-high" />
      <div className="h-4 w-5/6 rounded bg-surface-container-high" />
      <div className="mt-1 flex items-center justify-between border-t border-outline-variant/60 pt-3">
        <div className="h-4 w-24 rounded bg-surface-container-high" />
        <div className="h-4 w-12 rounded bg-surface-container-high" />
      </div>
    </div>
  );
}
