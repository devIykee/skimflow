/**
 * Public post serialization for the creator posts API + RSS feed.
 *
 * SECURITY INVARIANT: this module NEVER exposes paid block content. Every post
 * has exactly one free preview block (block 0); blocks 1..N are paid. The only
 * block text that leaves here is the FREE one:
 *   - article / book → the free chunk fetched via getFreeBlock (SQL filters
 *     is_free = TRUE, so paid text is never even loaded)
 *   - picture        → the free image URL + caption (the free preview IS an image)
 *   - agent-skills   → the generated block 0 (buildBlock0), which is public by
 *     design; the stored chunks (blocks 1..N) are never read here
 *
 * "monetization" is "free" when there are no payable blocks (block_count === 0)
 * and "paid" otherwise. Free posts expose their full content (which is just the
 * single free block); paid posts expose the teaser only.
 */
import type { Content, ContentType, User } from "./types.js";
import { getFreeBlock } from "./store.js";
import { buildBlock0, gatewayAddressFor } from "./agent-skills.js";

/** Canonical site origin, no trailing slash. */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://skimflow.vercel.app").replace(/\/$/, "");
}

export function readerUrl(slug: string): string {
  return `${siteUrl()}/read/${slug}`;
}

export function creatorProfileUrl(creatorId: string): string {
  return `${siteUrl()}/creator/${creatorId}`;
}

export function creatorFeedUrl(creatorId: string): string {
  return `${siteUrl()}/api/creators/${creatorId}/feed.xml`;
}

/** Escape a string for safe inclusion in HTML/XML text or attributes. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain text → minimal, escaped HTML: blank lines split paragraphs. */
function textToHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

export interface PublicCreator {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  bio: string | null;
  profileUrl: string;
}

export interface PublicPost {
  id: string;
  title: string;
  slug: string;
  url: string;
  publishDate: string; // ISO 8601
  contentType: ContentType;
  monetization: "free" | "paid";
  /** Full content (free posts only); null for paid posts. Minimal escaped HTML. */
  content: string | null;
  /** First free block, escaped HTML. Present for paid posts; null for free. */
  teaser: string | null;
  coverImageUrl: string | null;
}

/** Resolve a user's public display name (display_name → handle → "Creator"). */
export function publicName(u: Pick<User, "display_name" | "handle" | "name">): string {
  return u.display_name || u.handle || u.name || "Creator";
}

export function toPublicCreator(u: User): PublicCreator {
  return {
    id: u.id,
    name: publicName(u),
    handle: u.handle,
    avatarUrl: u.avatar,
    bio: u.bio,
    profileUrl: creatorProfileUrl(u.id),
  };
}

/**
 * Build the safe, escaped HTML preview for one content. Reads ONLY free content
 * (see module invariant). Returns "" if no free preview is available.
 */
async function freePreviewHtml(content: Content): Promise<string> {
  if (content.content_type === "agent-skills") {
    // Block 0 is generated, not stored — and is public by design.
    const md = buildBlock0({
      title: content.title,
      slug: content.slug,
      summary: content.summary,
      creatorHandle: null,
      pricePerBlock: content.price_per_block,
      gatewayAddress: gatewayAddressFor(content),
      payableBlocks: content.block_count,
      baseUrl: siteUrl(),
    });
    // Present the markdown as escaped preformatted text — safe, no paid data.
    return `<pre>${escapeHtml(md)}</pre>`;
  }

  const free = await getFreeBlock(content.id);
  if (!free) {
    // No stored free block — fall back to the (public) summary.
    return content.summary ? textToHtml(content.summary) : "";
  }

  if (content.content_type === "picture") {
    // The free preview IS an image. Render it + its caption; never any paid image.
    const img = free.image_url ? `<p><img src="${escapeHtml(free.image_url)}" alt="${escapeHtml(free.caption || content.title)}"/></p>` : "";
    const cap = free.caption ? `<p>${escapeHtml(free.caption)}</p>` : "";
    const intro = content.summary ? textToHtml(content.summary) : "";
    return [img, cap, intro].filter(Boolean).join("\n") || "";
  }

  // article / book: the free block is prose text.
  return textToHtml(free.text);
}

/** Serialize one content row into a safe public post. */
export async function serializePost(content: Content): Promise<PublicPost> {
  const monetization: "free" | "paid" = content.block_count > 0 ? "paid" : "free";
  const preview = await freePreviewHtml(content);
  return {
    id: content.id,
    title: content.title,
    slug: content.slug,
    url: readerUrl(content.slug),
    publishDate: (content.published_at ?? content.created_at).toISOString(),
    contentType: content.content_type,
    monetization,
    content: monetization === "free" ? preview : null,
    teaser: monetization === "paid" ? preview : null,
    coverImageUrl: content.cover_image_url,
  };
}

/** Serialize a list of content rows (already filtered to published). */
export function serializePosts(contents: Content[]): Promise<PublicPost[]> {
  return Promise.all(contents.map(serializePost));
}
