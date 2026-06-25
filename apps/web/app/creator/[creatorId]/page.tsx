import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getUserById, listPublishedByCreator } from "@/lib/store";
import { publicName } from "@/lib/creator-posts";

export const dynamic = "force-dynamic";

const FEED_LIMIT = 50;
const feedHref = (id: string) => `/api/creators/${id}/feed.xml`;

/** Public profile metadata + auto-discoverable RSS <link> in the head. */
export async function generateMetadata({ params }: { params: Promise<{ creatorId: string }> }): Promise<Metadata> {
  const { creatorId } = await params;
  const creator = await getUserById(creatorId).catch(() => null);
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
      canonical: `/creator/${creatorId}`,
      // Auto-discoverable RSS feed (RSS readers + RSSHub Radar pick this up).
      types: { "application/rss+xml": [{ url: feedHref(creatorId), title }] },
    },
    openGraph: { title, description, type: "profile", images: creator.avatar ? [{ url: creator.avatar }] : undefined },
  };
}

export default async function CreatorProfilePage({ params }: { params: Promise<{ creatorId: string }> }) {
  const { creatorId } = await params;
  const creator = await getUserById(creatorId).catch(() => null);
  if (!creator || creator.role === "admin" || creator.suspended) notFound();

  const name = publicName(creator);
  const posts = await listPublishedByCreator(creatorId, { limit: FEED_LIMIT });

  return (
    <div className="mx-auto max-w-max-width px-margin-mobile py-stack-lg md:px-margin-desktop">
      {/* Creator header */}
      <header className="mb-8 flex items-start gap-4">
        {creator.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={creator.avatar} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-container-high font-headline-sm text-[24px] font-semibold text-on-surface">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display-lg text-display-lg-mobile md:text-headline-md">{name}</h1>
            {creator.verified && <span className="material-symbols-outlined text-[18px] text-secondary" title="Verified">verified</span>}
            {/* Unobtrusive RSS subscribe link. */}
            <a
              href={feedHref(creatorId)}
              title={`Subscribe to ${name}'s RSS feed`}
              aria-label="RSS feed"
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-outline-variant px-2.5 py-1 text-[#ee802f] transition-colors hover:border-[#ee802f]"
            >
              <span className="material-symbols-outlined text-[16px]">rss_feed</span>
              <span className="font-label-caps text-label-caps">RSS</span>
            </a>
          </div>
          {creator.handle && <p className="font-body-sm text-body-sm text-on-surface-variant">@{creator.handle}</p>}
          {creator.bio && <p className="mt-2 max-w-2xl font-body-md text-body-md text-on-surface-variant">{creator.bio}</p>}
        </div>
      </header>

      {/* Posts */}
      <h2 className="mb-4 font-label-caps text-label-caps text-on-surface-variant">
        {posts.length} published post{posts.length === 1 ? "" : "s"}
      </h2>
      {posts.length === 0 ? (
        <p className="py-8 font-body-md text-on-surface-variant">No published posts yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-outline-variant">
          {posts.map((p) => {
            const paid = p.block_count > 0;
            const date = (p.published_at ?? p.created_at);
            return (
              <li key={p.id}>
                <Link href={`/read/${p.slug}`} className="flex items-center gap-4 py-4 transition-colors hover:bg-surface-container-low/50">
                  {p.cover_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.cover_image_url} alt="" className="h-16 w-12 shrink-0 rounded object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-headline-sm text-[15px] font-semibold text-on-surface">{p.title}</div>
                    {p.summary && <p className="line-clamp-1 font-body-sm text-[13px] text-on-surface-variant">{p.summary}</p>}
                    <div className="mt-1 flex items-center gap-2 font-body-sm text-[11px] text-outline">
                      <span className="pill text-[10px]">{p.content_type}</span>
                      <span className={paid ? "text-primary" : "text-secondary"}>{paid ? "Paid" : "Free"}</span>
                      <span>·</span>
                      <time dateTime={new Date(date).toISOString()}>{new Date(date).toLocaleDateString()}</time>
                    </div>
                  </div>
                  <span className="material-symbols-outlined shrink-0 text-outline">chevron_right</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
