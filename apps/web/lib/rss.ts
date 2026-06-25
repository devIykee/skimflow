/**
 * Pure RSS 2.0 rendering for creator feeds. No DB, no request context — takes
 * already-serialized (and already paid-gated) posts and emits valid RSS 2.0.
 * Kept separate from the route so it can be unit-tested with mock data.
 *
 * Author name uses <dc:creator> (the Dublin Core element) rather than <author>:
 * RSS 2.0's <author> is specified to contain an email address, and the W3C Feed
 * Validation Service flags a bare display name there as invalid. <dc:creator> is
 * the standard, validator-clean way to carry an author's NAME.
 */
import { escapeHtml, creatorFeedUrl, type PublicPost, type PublicCreator } from "./creator-posts.js";

/** RFC 822 date (RSS pubDate). toUTCString() yields the RFC 1123 profile RSS wants. */
function rfc822(iso: string): string {
  return new Date(iso).toUTCString();
}

/** Wrap an HTML fragment as CDATA for an RSS <description>. */
function cdata(html: string): string {
  return `<![CDATA[${html.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

/** The HTML description for one post — full content (free) or teaser + CTA (paid). */
export function descriptionHtml(post: PublicPost): string {
  if (post.monetization === "free") return post.content ?? "";
  const teaser = post.teaser ?? "";
  return `${teaser}\n<p><a href="${escapeHtml(post.url)}">Read the full post on Skimflow</a></p>`;
}

function renderItem(post: PublicPost, creatorName: string): string {
  return `    <item>
      <title>${escapeHtml(post.title)}</title>
      <link>${escapeHtml(post.url)}</link>
      <guid isPermaLink="false">${escapeHtml(post.id)}</guid>
      <pubDate>${rfc822(post.publishDate)}</pubDate>
      <dc:creator>${escapeHtml(creatorName)}</dc:creator>
      <description>${cdata(descriptionHtml(post))}</description>
    </item>`;
}

/** Render a complete RSS 2.0 document for a creator + their posts. */
export function renderCreatorFeed(creator: PublicCreator, posts: PublicPost[]): string {
  const channelTitle = `${creator.name} on Skimflow`;
  const channelDesc = creator.bio || `Posts by ${creator.name} on Skimflow — pay-per-block reading.`;
  const lastBuild = posts.length ? rfc822(posts[0].publishDate) : new Date().toUTCString();
  const image = creator.avatarUrl
    ? `    <image>
      <url>${escapeHtml(creator.avatarUrl)}</url>
      <title>${escapeHtml(channelTitle)}</title>
      <link>${escapeHtml(creator.profileUrl)}</link>
    </image>\n`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeHtml(channelTitle)}</title>
    <link>${escapeHtml(creator.profileUrl)}</link>
    <atom:link href="${escapeHtml(creatorFeedUrl(creator.id))}" rel="self" type="application/rss+xml"/>
    <description>${escapeHtml(channelDesc)}</description>
    <language>en</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${image}${posts.map((p) => renderItem(p, creator.name)).join("\n")}
  </channel>
</rss>
`;
}
