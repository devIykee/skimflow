import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  countPublishedByCreator,
  getFollowerCount,
  getFollowingCount,
  listPublishedByCreator,
} from "@/lib/store";
import { publicName, resolveCreator } from "@/lib/creator-posts";
import ProfileClient, { type ProfilePost } from "./_components/ProfileClient";

export const dynamic = "force-dynamic";

const FEED_LIMIT = 50;
const feedHref = (id: string) => `/api/creators/${id}/feed.xml`;

/** Public profile metadata + auto-discoverable RSS <link> in the head. */
export async function generateMetadata({ params }: { params: Promise<{ creatorId: string }> }): Promise<Metadata> {
  const { creatorId } = await params;
  const creator = await resolveCreator(creatorId).catch(() => null);
  if (!creator || creator.role === "admin" || creator.suspended) {
    return { title: "Creator not found", robots: { index: false, follow: false } };
  }
  const name = publicName(creator);
  const title = `${name} on Skimflow`;
  const description = creator.bio || `Posts by ${name} on Skimflow — pay-per-block reading in USDC.`;
  return {
    title,
    description,
    alternates: {
      canonical: `/creator/${creator.id}`,
      types: { "application/rss+xml": [{ url: feedHref(creator.id), title }] },
    },
    openGraph: { title, description, type: "profile", images: creator.avatar ? [{ url: creator.avatar }] : undefined },
  };
}

export default async function CreatorProfilePage({ params }: { params: Promise<{ creatorId: string }> }) {
  const { creatorId } = await params;
  const creator = await resolveCreator(creatorId).catch(() => null);
  if (!creator || creator.role === "admin" || creator.suspended) notFound();

  const [rows, postCount, followerCount, followingCount] = await Promise.all([
    listPublishedByCreator(creator.id, { limit: FEED_LIMIT }),
    countPublishedByCreator(creator.id),
    getFollowerCount(creator.id),
    getFollowingCount(creator.id),
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
        id: creator.id,
        name: publicName(creator),
        handle: creator.handle,
        avatar: creator.avatar,
        bio: creator.bio,
        verified: creator.verified,
      }}
      posts={posts}
      postCount={postCount}
      followerCount={followerCount}
      followingCount={followingCount}
      rssUrl={feedHref(creator.id)}
    />
  );
}
