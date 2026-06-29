"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatUsdc } from "@/lib/money";
import { timeAgo } from "@/lib/time-ago";
import FollowButton from "@/components/FollowButton";

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
}

interface Suggestion {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
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

  const pageRef = useRef(1);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

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

  const reload = useCallback(() => {
    pageRef.current = 1;
    hasMoreRef.current = true;
    setHasMore(true);
    void fetchPage(true);
  }, [fetchPage]);

  return (
    <div className="mx-auto max-w-[680px] px-margin-mobile py-stack-lg md:px-margin-desktop">
      <header className="mb-6">
        <h1 className="mb-1 font-display-lg text-display-lg-mobile md:text-display-lg">Following</h1>
        <p className="font-body-md text-body-md text-on-surface-variant">
          The latest from creators you follow, newest first.
        </p>
      </header>

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
          {posts.map((p) => (
            <PostCard key={p.id} p={p} />
          ))}
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

function PostCard({ p }: { p: FeedPost }) {
  const paid = (p.blockCount ?? 0) > 0;
  return (
    <article className="card flex flex-col gap-3 p-5">
      {/* Creator row. */}
      <div className="flex items-center gap-2">
        <Link href={`/creator/${p.creatorId}`} className="flex items-center gap-2 hover:opacity-90">
          <Avatar name={p.creatorName ?? p.creatorHandle} src={p.creatorAvatar} />
          <span className="flex items-baseline gap-1.5">
            <span className="font-body-sm text-[14px] font-semibold text-on-surface">
              {p.creatorName ?? p.creatorHandle ?? "Creator"}
            </span>
            {p.creatorHandle && (
              <span className="font-data-mono text-[12px] text-outline">@{p.creatorHandle}</span>
            )}
          </span>
        </Link>
        <span className="font-body-sm text-[12px] text-outline">· {timeAgo(p.publishedAt)}</span>
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

      {/* Footer. */}
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-outline-variant/60 pt-3">
        <div className="flex items-center gap-2">
          <span className="pill">{TYPE_LABEL[p.contentType] ?? p.contentType}</span>
          <span
            className={`font-data-mono text-[12px] ${paid ? "text-secondary" : "text-on-surface-variant"}`}
          >
            {paid ? `from ${formatUsdc(p.pricePerBlock)} USDC` : "Free"}
          </span>
        </div>
        <Link href={p.url} className="font-label-caps text-label-caps text-primary hover:underline">
          Read →
        </Link>
      </div>
    </article>
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
        <ul className="flex w-full max-w-md flex-col divide-y divide-outline-variant text-left">
          {suggestions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <Link href={`/creator/${s.id}`} className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-90">
                <Avatar name={s.name} src={s.avatarUrl} dim="h-9 w-9" />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate font-body-sm text-[14px] font-semibold text-on-surface">{s.name}</span>
                  {s.handle && <span className="truncate font-data-mono text-[12px] text-outline">@{s.handle}</span>}
                </span>
              </Link>
              <FollowButton userId={s.id} initialFollowing={false} size="sm" onChange={(f) => f && onFollow()} />
            </li>
          ))}
        </ul>
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
