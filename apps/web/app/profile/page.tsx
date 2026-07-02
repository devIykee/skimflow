import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  countPublishedByCreator,
  getFollowerCount,
  getFollowingCount,
  listPublishedByCreator,
} from "@/lib/store";
import { publicName } from "@/lib/creator-posts";
import { resolveActingUser } from "@/lib/session";
import ProfileClient, { type ProfilePost } from "../creator/[creatorId]/_components/ProfileClient";

export const dynamic = "force-dynamic";

// The signed-in user's own profile. Reuses the public creator-profile view
// (posts / replies / media / likes tabs — a list of their work, not a feed);
// ProfileClient renders the "own profile" affordances (Edit profile, etc.) via
// its isOwn check. Private, so it's excluded from search indexing.
export const metadata: Metadata = { title: "Your profile", robots: { index: false, follow: false } };

const FEED_LIMIT = 50;
const feedHref = (id: string) => `/api/creators/${id}/feed.xml`;

export default async function ProfilePage() {
  let ctx;
  try {
    ctx = await resolveActingUser();
  } catch {
    redirect("/login");
  }
  const user = ctx.user;

  const [rows, postCount, followerCount, followingCount] = await Promise.all([
    listPublishedByCreator(user.id, { limit: FEED_LIMIT }),
    countPublishedByCreator(user.id),
    getFollowerCount(user.id),
    getFollowingCount(user.id),
  ]);

  const posts: ProfilePost[] = rows.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    summary: p.summary,
    contentType: p.content_type,
    blockCount: p.block_count,
    coverImageUrl: p.cover_image_url,
    publishedAt: (p.published_at ?? p.created_at).toISOString(),
    url: `/read/${p.slug}`,
  }));

  return (
    <ProfileClient
      creator={{
        id: user.id,
        name: publicName(user),
        handle: user.handle,
        avatar: user.avatar,
        bio: user.bio,
        verified: user.verified,
      }}
      posts={posts}
      postCount={postCount}
      followerCount={followerCount}
      followingCount={followingCount}
      rssUrl={feedHref(user.id)}
    />
  );
}
