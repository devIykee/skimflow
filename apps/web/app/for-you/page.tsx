"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatUsdc } from "@/lib/money";
import ShareAgentButton from "@/components/ShareAgentButton";
import LikeButton from "@/components/motion/LikeButton";
import FollowButton from "@/components/FollowButton";
import QuickComposer from "@/components/composer/QuickComposer";
import ComposerFab from "@/components/composer/ComposerFab";
import type { ComposerCallbacks, CreatedContent, OptimisticPost } from "@/components/composer/ComposerForm";

// ─────────────────────────────────────────────────────────────────────────────
// "For You" — a social feed of pay-per-block content. Tabs strictly separate the
// content kinds; filters are reactive pills (no dropdowns); the feed loads more
// as you scroll. Keeps the app's light editorial look.
// ─────────────────────────────────────────────────────────────────────────────

interface FeedItem {
  id: string;
  slug: string;
  title: string;
  summary: string;
  excerpt?: string;
  contentType: string;
  pricePerBlock: string;
  blockCount?: number;
  coverImageUrl?: string | null;
  creatorHandle: string | null;
  creatorName: string | null;
  creatorAvatar?: string | null;
  creatorVerified?: boolean;
  ownershipVerified?: boolean;
  sourcePlatform?: string | null;
  url: string;
  agentUrl?: string | null;
  likeCount?: number;
  commentCount?: number;
  liked?: boolean;
  creatorId?: string;
  authorFollowing?: boolean;
}

type TabKey = "all" | "article" | "book" | "agent-skills" | "picture";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "article", label: "Articles" },
  { key: "book", label: "Books" },
  { key: "picture", label: "Skimflow" },
  { key: "agent-skills", label: "Agent Skills" },
];

const TYPE_LABEL: Record<string, string> = {
  article: "Article",
  book: "Book",
  "agent-skills": "Agent Skills",
  picture: "Skimflow",
};

const PAGE = 12;

function normalizeSearchRow(r: {
  id: string;
  slug: string;
  title: string;
  summary: string;
  excerpt?: string;
  content_type: string;
  price_per_block: string;
  creator_handle: string | null;
  creator_name: string | null;
  url?: string;
}): FeedItem {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    excerpt: r.excerpt,
    contentType: r.content_type,
    pricePerBlock: r.price_per_block,
    creatorHandle: r.creator_handle,
    creatorName: r.creator_name,
    url: r.url ?? `/read/${r.slug}`,
  };
}

export default function ForYouPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<TabKey>("all");
  const [sort, setSort] = useState<"newest" | "popular">("newest");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const searching = q.trim().length > 0;

  // Composer wiring. New quick posts are articles, so only optimistically prepend
  // them in the default browse view (All tab, no search); elsewhere the post
  // still publishes and shows on the next load.
  const composerCallbacks: ComposerCallbacks = useMemo(() => {
    const defaultView = tab === "all" && !searching;
    return {
      onPending: (t: OptimisticPost) => {
        if (!defaultView) return;
        const item: FeedItem = {
          id: t.tempId,
          slug: "",
          title: t.title,
          summary: t.summary,
          contentType: "article",
          pricePerBlock: "0",
          blockCount: 0,
          creatorHandle: t.author.handle,
          creatorName: t.author.name,
          creatorAvatar: t.author.avatarUrl,
          url: "#",
        };
        setItems((prev) => [item, ...prev]);
      },
      onSuccess: (tempId: string, c: CreatedContent) => {
        setItems((prev) =>
          prev.map((it) =>
            it.id === tempId
              ? {
                  ...it,
                  id: c.id,
                  slug: c.slug,
                  title: c.title,
                  summary: c.summary,
                  contentType: c.content_type,
                  pricePerBlock: c.price_per_block,
                  blockCount: c.block_count,
                  url: `/read/${c.slug}`,
                }
              : it
          )
        );
      },
      onError: (tempId: string) => setItems((prev) => prev.filter((it) => it.id !== tempId)),
    };
  }, [tab, searching]);

  // Build the request URL for the current state at a given offset.
  const buildUrl = useCallback(
    (offset: number) => {
      const p = new URLSearchParams();
      p.set("limit", String(PAGE));
      p.set("offset", String(offset));
      if (searching) {
        p.set("q", q.trim());
        return `/api/marketplace/search?${p}`;
      }
      if (tab !== "all") p.set("type", tab);
      p.set("sort", sort);
      return `/api/marketplace?${p}`;
    },
    [q, tab, sort, searching]
  );

  const fetchPage = useCallback(
    async (reset: boolean) => {
      if (loadingRef.current) return;
      if (!reset && !hasMoreRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      const offset = reset ? 0 : offsetRef.current;
      try {
        const res = await fetch(buildUrl(offset));
        const data = await res.json();
        const raw: FeedItem[] = searching
          ? (data.results ?? []).map(normalizeSearchRow)
          : data.items ?? [];
        const pageFull = raw.length === PAGE; // server returned a full page → maybe more
        // Client-side refinements the API doesn't cover.
        let rows = raw;
        if (searching) {
          // Search hits all types; keep the active tab's content. "All" mixes
          // human content (articles + posts) but never books or agent skills —
          // books stay in their own tab so their cover cards don't distort the feed.
          rows = rows.filter((r) =>
            tab === "all" ? r.contentType !== "agent-skills" && r.contentType !== "book" : r.contentType === tab
          );
        }
        if (verifiedOnly && !searching) rows = rows.filter((r) => r.creatorVerified);

        offsetRef.current = offset + PAGE;
        hasMoreRef.current = pageFull;
        setHasMore(pageFull);
        setItems((prev) => (reset ? rows : [...prev, ...rows]));
      } catch {
        hasMoreRef.current = false;
        setHasMore(false);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [buildUrl, searching, tab, verifiedOnly]
  );

  // Reset + load the first page whenever the query shape changes (debounced).
  useEffect(() => {
    const t = setTimeout(() => {
      offsetRef.current = 0;
      hasMoreRef.current = true;
      setHasMore(true);
      setItems([]);
      void fetchPage(true);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tab, sort, verifiedOnly]);

  // Infinite scroll: load more when the sentinel enters view.
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

  return (
    <div className="mx-auto max-w-max-width px-margin-mobile py-stack-lg md:px-margin-desktop">
      <header className="mb-6">
        <h1 className="mb-2 font-display-lg text-display-lg-mobile md:text-display-lg">For You</h1>
        <p className="max-w-2xl font-body-lg text-body-lg text-on-surface-variant">
          Pay-per-block content for humans and agents. Read the free block, then unlock the rest in USDC on Arc.
        </p>
      </header>

      {/* Frictionless composer: sticky on desktop, FAB on mobile (signed-in only). */}
      <QuickComposer surface="for-you" callbacks={composerCallbacks} />
      <ComposerFab surface="for-you" callbacks={composerCallbacks} />

      {/* Tabs — strictly separated content kinds. */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-pressed={active}
              className={`shrink-0 rounded-full px-4 py-1.5 font-label-caps text-label-caps transition-colors ${
                active
                  ? "bg-primary text-on-primary"
                  : "border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Filter row — search + reactive sort/verified pills (no dropdowns). */}
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <div className="relative flex-grow">
          <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline">
            search
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search content…"
            className="w-full rounded-full border border-outline-variant bg-surface-container-lowest py-2 pl-10 pr-4 font-body-md text-body-md focus:border-primary focus:outline-none"
          />
        </div>

        {!searching && (
          <div className="flex items-center gap-2">
            <FilterPill active={sort === "newest"} onClick={() => setSort("newest")}>
              Newest
            </FilterPill>
            <FilterPill active={sort === "popular"} onClick={() => setSort("popular")}>
              Popular
            </FilterPill>
            <FilterPill active={verifiedOnly} onClick={() => setVerifiedOnly((v) => !v)}>
              Verified ✓
            </FilterPill>
          </div>
        )}
      </div>

      {/* Feed — Books render as a denser cover grid; everything else as cards. */}
      <div
        className={
          tab === "book"
            ? "grid grid-cols-2 gap-gutter sm:grid-cols-3 md:grid-cols-4"
            : "grid grid-cols-1 gap-gutter md:grid-cols-2"
        }
      >
        {items.map((c) =>
          c.contentType === "book" ? (
            <BookCard key={c.id} c={c} />
          ) : (
          <article
            key={c.id}
            className="card group flex flex-col text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            {/* Body links to the post; the author row (below) links to the profile. */}
            <Link href={c.url} className="flex flex-1 flex-col text-left">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="pill">{TYPE_LABEL[c.contentType] ?? c.contentType}</span>
                <div className="flex items-center gap-2">
                  {c.ownershipVerified && (
                    <span
                      className="flex items-center gap-0.5 font-label-caps text-label-caps text-secondary"
                      title={`Ownership of the original ${c.sourcePlatform ?? "source"} verified`}
                    >
                      <span className="material-symbols-outlined text-[14px]">verified</span>source
                    </span>
                  )}
                  {c.agentUrl && (
                    <span className="font-data-mono text-[11px] text-primary" title="Agent-readable endpoint">
                      agent-ready
                    </span>
                  )}
                  {c.creatorVerified && (
                    <span className="flex items-center gap-0.5 font-label-caps text-label-caps text-secondary">
                      <span className="material-symbols-outlined text-[14px]">verified</span>verified
                    </span>
                  )}
                </div>
              </div>

              <h3 className="mb-2 font-headline-sm text-headline-sm leading-tight group-hover:text-primary">
                {c.title}
              </h3>
              {c.excerpt ? (
                <p
                  className="mb-4 flex-grow font-body-sm text-body-sm text-on-surface-variant [&_mark]:bg-primary/15 [&_mark]:text-on-surface"
                  dangerouslySetInnerHTML={{ __html: c.excerpt }}
                />
              ) : (
                <p className="mb-4 line-clamp-3 flex-grow font-body-sm text-body-sm text-on-surface-variant">{c.summary}</p>
              )}
            </Link>

            {/* Engagement signals (hidden on optimistic/pending items). */}
            {!c.id.startsWith("temp-") && (
              <div className="mb-1 flex items-center gap-4">
                <LikeButton kind="post" id={c.id} initialLiked={!!c.liked} initialCount={c.likeCount ?? 0} size="sm" />
                <Link
                  href={c.url}
                  className="inline-flex items-center gap-1 text-on-surface-variant transition-colors hover:text-primary"
                  aria-label="Comments"
                >
                  <span className="material-symbols-outlined text-[18px]">chat_bubble</span>
                  {(c.commentCount ?? 0) > 0 && <span className="font-body-sm text-[12px]">{c.commentCount}</span>}
                </Link>
              </div>
            )}

            <div className="mt-auto flex items-center justify-between gap-2 border-t border-outline-variant/60 pt-3">
              {c.creatorHandle ? (
                <Link
                  href={`/creator/${c.creatorHandle}`}
                  className="flex min-w-0 items-center gap-2 hover:opacity-90"
                  title={`View ${c.creatorName ?? `@${c.creatorHandle}`}'s profile`}
                >
                  <Avatar name={c.creatorName ?? c.creatorHandle} src={c.creatorAvatar} />
                  <span className="flex min-w-0 flex-col leading-tight">
                    {c.creatorName && (
                      <span className="truncate font-body-sm text-[12px] text-on-surface">{c.creatorName}</span>
                    )}
                    <span className="truncate font-data-mono text-[11px] text-outline hover:text-primary">@{c.creatorHandle}</span>
                  </span>
                </Link>
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar name={c.creatorName ?? c.creatorHandle} src={c.creatorAvatar} />
                  <span className="flex min-w-0 flex-col leading-tight">
                    {c.creatorName && (
                      <span className="truncate font-body-sm text-[12px] text-on-surface">{c.creatorName}</span>
                    )}
                    <span className="truncate font-data-mono text-[11px] text-outline">@unknown</span>
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 font-data-mono text-[12px]">
                {c.creatorId && !c.id.startsWith("temp-") && (
                  <FollowButton userId={c.creatorId} name={c.creatorName} initialFollowing={!!c.authorFollowing} size="sm" />
                )}
                {c.contentType === "agent-skills" && (
                  <ShareAgentButton slug={c.slug} title={c.title} pricePerBlock={c.pricePerBlock} variant="card" />
                )}
                {typeof c.blockCount === "number" && c.blockCount > 0 && (
                  <span className="text-outline">{c.blockCount} blocks</span>
                )}
                <span className="rounded-full bg-secondary/10 px-2 py-0.5 text-secondary">{formatUsdc(c.pricePerBlock)} USDC</span>
              </div>
            </div>
          </article>
          )
        )}
      </div>

      {/* States */}
      {loading && items.length === 0 && (
        <div className="grid grid-cols-1 gap-gutter md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <FeedSkeleton key={i} />
          ))}
        </div>
      )}
      {!loading && items.length === 0 && <EmptyState tab={tab} q={q.trim()} />}

      {/* Infinite-scroll sentinel + footer status */}
      <div ref={sentinelRef} aria-hidden className="h-px" />
      {loading && items.length > 0 && (
        <p className="mt-6 text-center font-body-sm text-on-surface-variant">Loading more…</p>
      )}
      {!hasMore && items.length > 0 && (
        <p className="mt-6 text-center font-body-sm text-outline">You&apos;re all caught up.</p>
      )}
    </div>
  );
}

/** Pulse skeleton matching the feed card while the first page loads. */
function FeedSkeleton() {
  return (
    <div className="card flex animate-pulse flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="h-4 w-16 rounded-full bg-surface-container-high" />
        <div className="h-4 w-12 rounded bg-surface-container-high" />
      </div>
      <div className="h-5 w-3/4 rounded bg-surface-container-high" />
      <div className="h-4 w-full rounded bg-surface-container-high" />
      <div className="h-4 w-5/6 rounded bg-surface-container-high" />
      <div className="mt-2 flex items-center gap-4">
        <div className="h-4 w-10 rounded bg-surface-container-high" />
        <div className="h-4 w-10 rounded bg-surface-container-high" />
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-outline-variant/60 pt-3">
        <div className="h-6 w-24 rounded-full bg-surface-container-high" />
        <div className="h-4 w-16 rounded bg-surface-container-high" />
      </div>
    </div>
  );
}

/** Cover-forward card for the Books tab — cover image, title, author, synopsis. */
function BookCard({ c }: { c: FeedItem }) {
  return (
    <Link href={c.url} className="group flex flex-col text-left">
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low editorial-shadow">
        {c.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.coverImageUrl}
            alt={c.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
            <span className="material-symbols-outlined text-[28px] text-outline">menu_book</span>
            <span className="line-clamp-3 font-headline-sm text-[15px] leading-tight">{c.title}</span>
          </div>
        )}
        <span className="absolute left-2 top-2 pill bg-surface/80 backdrop-blur">Book</span>
      </div>
      <h3 className="mt-2 line-clamp-2 font-headline-sm text-[15px] leading-tight group-hover:text-primary">{c.title}</h3>
      <span className="truncate font-data-mono text-[11px] text-outline">@{c.creatorHandle ?? "unknown"}</span>
      {c.summary && <p className="mt-1 line-clamp-2 font-body-sm text-[12px] text-on-surface-variant">{c.summary}</p>}
    </Link>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 font-label-caps text-label-caps transition-colors ${
        active
          ? "bg-secondary/15 text-secondary"
          : "border border-outline-variant text-on-surface-variant hover:border-secondary hover:text-secondary"
      }`}
    >
      {children}
    </button>
  );
}

function Avatar({ name, src }: { name: string | null; src?: string | null }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="h-6 w-6 rounded-full object-cover" />;
  }
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 font-label-caps text-[11px] text-primary">
      {initial}
    </span>
  );
}

function EmptyState({ tab, q }: { tab: TabKey; q: string }) {
  if (q) {
    return (
      <div className="mt-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center">
        <p className="font-body-md text-on-surface-variant">
          No results for <span className="font-data-mono text-on-surface">“{q}”</span>.
        </p>
      </div>
    );
  }
  if (tab === "book") {
    return (
      <div className="mt-2 flex flex-col items-center gap-2 rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-10 text-center">
        <span className="material-symbols-outlined text-[28px] text-primary">menu_book</span>
        <h3 className="font-headline-sm text-headline-sm">No books yet</h3>
        <p className="max-w-md font-body-sm text-body-sm text-on-surface-variant">
          Long-form, serialized reads. Pay as you turn the page. Creators can publish one from the dashboard.
        </p>
      </div>
    );
  }
  if (tab === "picture") {
    return (
      <div className="mt-2 flex flex-col items-center gap-2 rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-10 text-center">
        <span className="material-symbols-outlined text-[28px] text-primary">collections</span>
        <h3 className="font-headline-sm text-headline-sm">No Skimflows yet</h3>
        <p className="max-w-md font-body-sm text-body-sm text-on-surface-variant">
          Skimflow posts (pay-per-image picture sequences) show up here. Creators can publish one from the dashboard.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center">
      <p className="font-body-md text-on-surface-variant">Nothing here yet. Check back soon.</p>
    </div>
  );
}
