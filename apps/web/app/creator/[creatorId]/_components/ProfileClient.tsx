"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/Toaster";
import { timeAgo } from "@/lib/time-ago";
import FollowButton from "@/components/FollowButton";
import AnimatedCount from "@/components/motion/AnimatedCount";
import FollowListModal from "./FollowListModal";

export interface ProfilePost {
  id: string;
  slug: string;
  title: string;
  summary: string;
  contentType: string;
  blockCount: number;
  coverImageUrl: string | null;
  publishedAt: string;
  url: string;
}

interface Creator {
  id: string;
  name: string;
  handle: string | null;
  avatar: string | null;
  bio: string | null;
  verified: boolean;
}

interface Reply {
  id: string;
  content: string;
  createdAt: string;
  postTitle: string;
  url: string;
}

type Tab = "posts" | "replies" | "media" | "likes";

/** Deterministic gradient banner from the user id — never a blank grey bar. */
function bannerFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (Math.floor(h / 7) % 360);
  return `linear-gradient(120deg, hsl(${a} 55% 42%), hsl(${b} 60% 32%))`;
}

export default function ProfileClient({
  creator,
  posts,
  postCount,
  followerCount,
  followingCount,
  rssUrl,
}: {
  creator: Creator;
  posts: ProfilePost[];
  postCount: number;
  followerCount: number;
  followingCount: number;
  rssUrl: string;
}) {
  const { data: session } = useSession();
  const toast = useToast();
  const isOwn = session?.user?.id === creator.id;

  const [tab, setTab] = useState<Tab>("posts");
  const [modal, setModal] = useState<null | "followers" | "following">(null);
  const [bioDismissed, setBioDismissed] = useState(false);

  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [likes, setLikes] = useState<ProfilePost[] | null>(null);
  const [tabLoading, setTabLoading] = useState(false);

  const media = posts.filter((p) => p.contentType === "picture");

  const loadTab = useCallback(
    async (t: Tab) => {
      if (t === "replies" && replies === null) {
        setTabLoading(true);
        try {
          const r = await fetch(`/api/creators/${creator.id}/replies`);
          const d = await r.json();
          setReplies(d.replies ?? []);
        } catch {
          setReplies([]);
        } finally {
          setTabLoading(false);
        }
      } else if (t === "likes" && likes === null) {
        setTabLoading(true);
        try {
          const r = await fetch(`/api/creators/${creator.id}/likes`);
          const d = await r.json();
          setLikes(d.posts ?? []);
        } catch {
          setLikes([]);
        } finally {
          setTabLoading(false);
        }
      }
    },
    [creator.id, replies, likes]
  );

  useEffect(() => {
    void loadTab(tab);
  }, [tab, loadTab]);

  async function share() {
    const url = `${window.location.origin}/creator/${creator.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("success", "Profile link copied.");
    } catch {
      toast("error", "Couldn't copy the link.");
    }
  }

  return (
    <div className="mx-auto max-w-max-width pb-16">
      {/* Banner + avatar. */}
      <div className="relative">
        <div className="h-40 w-full md:h-52" style={{ background: bannerFor(creator.id) }} />
        <div className="mx-auto max-w-3xl px-margin-mobile md:px-margin-desktop">
          <div className="-mt-12 flex items-end justify-between gap-4">
            {creator.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={creator.avatar}
                alt=""
                className="h-24 w-24 rounded-full border-4 border-background object-cover"
              />
            ) : (
              <span className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-background bg-surface-container-high font-display-lg text-[32px] font-semibold text-on-surface">
                {creator.name.charAt(0).toUpperCase()}
              </span>
            )}

            <div className="mb-2 flex items-center gap-2">
              <button
                onClick={share}
                aria-label="Copy profile link"
                title="Copy profile link"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
              >
                <span className="material-symbols-outlined text-[18px]">link</span>
              </button>
              <a
                href={rssUrl}
                aria-label="RSS feed"
                title="RSS feed"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-outline-variant text-[#ee802f] transition-colors hover:border-[#ee802f]"
              >
                <span className="material-symbols-outlined text-[18px]">rss_feed</span>
              </a>
              {isOwn ? (
                <Link
                  href="/dashboard/settings"
                  className="rounded-full bg-primary px-4 py-1.5 font-label-caps text-label-caps text-on-primary transition-colors hover:bg-primary/90"
                >
                  Edit profile
                </Link>
              ) : (
                <FollowButton userId={creator.id} name={creator.name} initialFollowerCount={followerCount} />
              )}
            </div>
          </div>

          {/* Identity. */}
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display-lg text-display-lg-mobile md:text-headline-md">{creator.name}</h1>
              {creator.verified && (
                <span className="material-symbols-outlined text-[18px] text-secondary" title="Verified creator">
                  verified
                </span>
              )}
            </div>
            {creator.handle && <p className="font-body-sm text-body-sm text-on-surface-variant">@{creator.handle}</p>}
            {creator.bio && <p className="mt-2 max-w-2xl font-body-md text-body-md text-on-surface-variant">{creator.bio}</p>}

            {/* Own-profile completion nudge. */}
            {isOwn && !creator.bio && !bioDismissed && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2.5">
                <span className="font-body-sm text-[13px] text-on-surface-variant">
                  Add a bio to help readers find you.
                </span>
                <span className="flex items-center gap-3">
                  <Link href="/dashboard/settings" className="font-label-caps text-label-caps text-primary hover:underline">
                    Add bio
                  </Link>
                  <button onClick={() => setBioDismissed(true)} aria-label="Dismiss" className="text-outline hover:text-on-surface">
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </span>
              </div>
            )}

            {/* Stats. */}
            <div className="mt-4 flex items-center gap-6">
              <Stat label="Posts" value={postCount} />
              <button onClick={() => setModal("followers")} className="transition-opacity hover:opacity-80">
                <Stat label="Followers" value={followerCount} />
              </button>
              <button onClick={() => setModal("following")} className="transition-opacity hover:opacity-80">
                <Stat label="Following" value={followingCount} />
              </button>
            </div>
          </div>

          {/* Tabs. */}
          <div className="mt-6 flex gap-1 border-b border-outline-variant">
            {(["posts", "replies", "media", "likes"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-4 py-2 font-label-caps text-label-caps capitalize transition-colors ${
                  tab === t
                    ? "border-primary text-primary"
                    : "border-transparent text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Tab content. */}
          <div className="mt-4">
            {tab === "posts" && <PostList posts={posts} empty="No published posts yet." />}
            {tab === "media" && <PostList posts={media} empty="No picture posts yet." />}
            {tab === "likes" &&
              (tabLoading && likes === null ? (
                <TabSkeleton />
              ) : (
                <PostList posts={likes ?? []} empty="No liked posts yet." />
              ))}
            {tab === "replies" &&
              (tabLoading && replies === null ? (
                <TabSkeleton />
              ) : (replies ?? []).length === 0 ? (
                <p className="py-8 font-body-md text-on-surface-variant">No replies yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-outline-variant">
                  {(replies ?? []).map((r) => (
                    <li key={r.id}>
                      <Link href={r.url} className="flex flex-col gap-1 py-4 transition-colors hover:bg-surface-container-low/50">
                        <span className="font-body-md text-body-md text-on-surface">{r.content}</span>
                        <span className="font-body-sm text-[12px] text-outline">
                          on {r.postTitle} · {timeAgo(r.createdAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        </div>
      </div>

      {modal && (
        <FollowListModal userId={creator.id} type={modal} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <AnimatedCount value={value} className="font-headline-sm text-[16px] font-semibold text-on-surface" />
      <span className="font-body-sm text-[13px] text-on-surface-variant">{label}</span>
    </span>
  );
}

function PostList({ posts, empty }: { posts: ProfilePost[]; empty: string }) {
  if (posts.length === 0) return <p className="py-8 font-body-md text-on-surface-variant">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-outline-variant">
      {posts.map((p) => {
        const paid = p.blockCount > 0;
        return (
          <li key={p.id}>
            <Link href={p.url} className="flex items-center gap-4 py-4 transition-colors hover:bg-surface-container-low/50">
              {p.coverImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.coverImageUrl} alt="" className="h-16 w-12 shrink-0 rounded object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-headline-sm text-[15px] font-semibold text-on-surface">{p.title}</div>
                {p.summary && <p className="line-clamp-1 font-body-sm text-[13px] text-on-surface-variant">{p.summary}</p>}
                <div className="mt-1 flex items-center gap-2 font-body-sm text-[11px] text-outline">
                  <span className="pill text-[10px]">{p.contentType}</span>
                  <span className={paid ? "text-primary" : "text-secondary"}>{paid ? "Paid" : "Free"}</span>
                  <span>·</span>
                  <time dateTime={p.publishedAt}>{new Date(p.publishedAt).toLocaleDateString()}</time>
                </div>
              </div>
              <span className="material-symbols-outlined shrink-0 text-outline">chevron_right</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TabSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4 py-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-14 rounded-lg bg-surface-container-high" />
      ))}
    </div>
  );
}
