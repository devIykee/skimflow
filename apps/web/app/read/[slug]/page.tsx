import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getChapters, getChunks, getContentWithCreator, getUserById, incrementView } from "@/lib/store";
import { currentSession } from "@/lib/session";
import ChunkReader from "./_components/ChunkReader";
import BookReader from "./_components/BookReader";
import CommentsSection from "./_components/CommentsSection";

export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "https://skimflow.vercel.app").replace(/\/$/, "");

/** Collapse whitespace and clip to a meta-description-friendly length. */
function clip(s: string, n = 155): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

/** Per-piece SEO: real title/description/canonical/OG instead of the site default. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const content = await getContentWithCreator(slug).catch(() => null);
  if (!content || content.status !== "published") {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
  const url = `${SITE}/read/${content.slug}`;
  const author = content.creator_name || (content.creator_handle ? `@${content.creator_handle}` : "Skimflow");
  const description = clip(content.summary) || `Read “${content.title}” on Skimflow — pay-per-block in USDC.`;
  const image = content.cover_image_url || `${SITE}/logo.svg`;
  const isBook = content.content_type === "book";
  // Server-rendered RSS discovery: point every post page at its creator's feed so
  // Folo / RSSHub Radar can auto-subscribe straight from a single post (read raw HTML).
  const feedUrl = `${SITE}/api/creators/${content.creator_id}/feed.xml`;
  const feedTitle = `${content.title} — ${author} on Skimflow`;
  return {
    title: content.title,
    description,
    alternates: {
      canonical: url,
      types: { "application/rss+xml": [{ url: feedUrl, title: feedTitle }] },
    },
    authors: content.creator_handle ? [{ name: author }] : undefined,
    keywords: content.tags ? content.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    openGraph: {
      type: isBook ? "book" : "article",
      title: content.title,
      description,
      url,
      siteName: "Skimflow",
      images: [{ url: image, alt: content.title }],
    },
    twitter: { card: "summary_large_image", title: content.title, description, images: [image] },
  };
}

export default async function ReaderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const content = await getContentWithCreator(slug);
  if (!content) notFound();

  if (content.status === "suspended") {
    return (
      <div className="mx-auto max-w-3xl px-margin-mobile py-32 text-center md:px-margin-desktop">
        <h1 className="mb-2 font-headline-sm text-headline-sm">Content suspended</h1>
        <p className="font-body-md text-on-surface-variant">
          {content.suspended_reason ?? "This content has been suspended by the platform."}
        </p>
      </div>
    );
  }
  if (content.status !== "published") notFound();

  void incrementView(content.id);
  const chunks = await getChunks(content.id);

  // The creator (and admins) read their own piece in full, free — so we hand the
  // client every block's text up front and tell it to skip the paywall entirely.
  const viewer = await currentSession();
  let isOwner = false;
  if (viewer?.user?.id) {
    isOwner = content.creator_id === viewer.user.id;
    if (!isOwner) {
      const vu = await getUserById(viewer.user.id);
      isOwner = vu?.role === "admin";
    }
  }

  // Structured data so Google understands the piece (author, dates, paywall).
  const author = content.creator_name || (content.creator_handle ? `@${content.creator_handle}` : "Skimflow");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": content.content_type === "book" ? "Book" : "Article",
    name: content.title,
    headline: content.title,
    description: content.summary || undefined,
    image: content.cover_image_url || `${SITE}/logo.svg`,
    url: `${SITE}/read/${content.slug}`,
    datePublished: content.published_at ? new Date(content.published_at).toISOString() : undefined,
    dateModified: content.updated_at ? new Date(content.updated_at).toISOString() : undefined,
    author: { "@type": "Person", name: author },
    publisher: {
      "@type": "Organization",
      name: "Skimflow",
      logo: { "@type": "ImageObject", url: `${SITE}/logo.svg` },
    },
    // Paywalled: first block free, the rest unlock with USDC.
    isAccessibleForFree: false,
  };
  const JsonLd = (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
  );

  // Books open in the full-screen Moon+ reader instead of the vertical reader.
  if (content.content_type === "book") {
    const chapters = await getChapters(content.id);
    return (
      <>
        {JsonLd}
        <BookReader
          slug={content.slug}
          title={content.title}
          creatorHandle={content.creator_handle}
          pricePerBlock={content.price_per_block}
          isOwner={isOwner}
          contentId={content.id}
          chapters={chapters.map((ch) => ({ id: ch.id, index: ch.chapter_index, title: ch.title }))}
          pages={chunks.map((c) => ({
            id: c.id,
            blockIndex: c.block_index,
            isFree: c.is_free,
            chapterId: c.chapter_id,
            text: c.is_free || isOwner ? c.text : null,
          }))}
        />
      </>
    );
  }

  return (
    <>
      {JsonLd}
      <ChunkReader
        slug={content.slug}
        title={content.title}
        summary={content.summary}
        creatorHandle={content.creator_handle}
        contentType={content.content_type}
        pricePerBlock={content.price_per_block}
        isOwner={isOwner}
        contentId={content.id}
        verifiedSource={content.ownership_verified ? (content.source_platform ?? "source") : null}
        agentUrl={content.content_type === "agent-skills" ? `/read/${content.slug}/agent-skills.md` : null}
        chunks={chunks.map((c) => ({
          id: c.id,
          blockIndex: c.block_index,
          isFree: c.is_free,
          // For picture posts `text` holds the (gated) image URL; the caption is an
          // always-visible label, so it's sent regardless of lock state. Owners
          // receive every block's text up front (they read their own work free).
          text: c.is_free || isOwner ? c.text : null,
          caption: c.caption,
        }))}
      />
      {/* Social discussion lives below the reader (not on the full-screen book reader). */}
      <CommentsSection postId={content.id} />
    </>
  );
}
