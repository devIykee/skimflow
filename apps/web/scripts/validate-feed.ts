/**
 * Offline validation of the RSS renderer (no DB, no network). Renders a feed
 * with adversarial mock data and asserts RSS 2.0 structural + escaping rules.
 * Run: npx tsx scripts/validate-feed.ts
 *
 * NOTE: this tests the XML rendering + escaping. The end-to-end paid-leak test
 * (real DB) and the live W3C Feed Validator run require the running app.
 */
import { renderCreatorFeed } from "../lib/rss.js";
import type { PublicCreator, PublicPost } from "../lib/creator-posts.js";

const creator: PublicCreator = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Ada & <Friends>",
  handle: "ada",
  avatarUrl: "https://example.com/a.png?x=1&y=2",
  bio: "Writing about math & machines <since 1843>",
  profileUrl: "https://skimflow.vercel.app/creator/11111111-1111-1111-1111-111111111111",
};

const posts: PublicPost[] = [
  {
    id: "p-free", title: "A Free Post & Its <Title>", slug: "free-post",
    url: "https://skimflow.vercel.app/read/free-post", publishDate: "2026-06-20T10:00:00.000Z",
    contentType: "article", monetization: "free",
    content: "<p>Full free content &amp; more.</p>", teaser: null, coverImageUrl: null,
  },
  {
    id: "p-paid", title: "Paid Article", slug: "paid-post",
    url: "https://skimflow.vercel.app/read/paid-post", publishDate: "2026-06-19T08:30:00.000Z",
    contentType: "article", monetization: "paid",
    content: null, teaser: "<p>Teaser with &amp; and &lt;tag&gt; and a tricky ]]> sequence.</p>", coverImageUrl: null,
  },
  {
    id: "p-pic", title: "Picture Story", slug: "pic-post",
    url: "https://skimflow.vercel.app/read/pic-post", publishDate: "2026-06-18T08:30:00.000Z",
    contentType: "picture", monetization: "paid",
    content: null, teaser: '<p><img src="https://img/x?a=1&amp;b=2" alt="cap"/></p>', coverImageUrl: "https://img/cover.jpg",
  },
  {
    id: "p-agent", title: "Agent Skill", slug: "agent-post",
    url: "https://skimflow.vercel.app/read/agent-post", publishDate: "2026-06-17T08:30:00.000Z",
    contentType: "agent-skills", monetization: "paid",
    content: null, teaser: "<pre># Skill\nFree onboarding &amp; pricing.</pre>", coverImageUrl: null,
  },
];

const xml = renderCreatorFeed(creator, posts);

const checks: Array<[string, boolean]> = [
  ["starts with XML decl", xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')],
  ["rss 2.0 root", /<rss version="2\.0"/.test(xml)],
  ["declares dc namespace", xml.includes('xmlns:dc="http://purl.org/dc/elements/1.1/"')],
  ["declares atom namespace", xml.includes('xmlns:atom="http://www.w3.org/2005/Atom"')],
  ["channel title", xml.includes("<title>Ada &amp; &lt;Friends&gt; on Skimflow</title>")],
  ["channel link", xml.includes("<link>https://skimflow.vercel.app/creator/11111111-1111-1111-1111-111111111111</link>")],
  ["atom self link", xml.includes('<atom:link href="https://skimflow.vercel.app/api/creators/11111111-1111-1111-1111-111111111111/feed.xml" rel="self"')],
  ["language en", xml.includes("<language>en</language>")],
  ["lastBuildDate present", /<lastBuildDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT<\/lastBuildDate>/.test(xml)],
  ["channel image (avatar)", xml.includes("<image>") && xml.includes("a.png?x=1&amp;y=2")],
  ["one item per post", (xml.match(/<item>/g) || []).length === posts.length],
  ["every item has guid", (xml.match(/<guid /g) || []).length === posts.length],
  ["every item has pubDate", (xml.match(/<pubDate>/g) || []).length === posts.length],
  ["every item has dc:creator", (xml.match(/<dc:creator>/g) || []).length === posts.length],
  ["pubDate is RFC822", /<pubDate>Fri, 19 Jun 2026 08:30:00 GMT<\/pubDate>/.test(xml)],
  ["descriptions wrapped in CDATA", (xml.match(/<description><!\[CDATA\[/g) || []).length === posts.length],
  ["free post shows full content", xml.includes("Full free content &amp; more.")],
  ["paid post shows teaser", xml.includes("Teaser with &amp; and &lt;tag&gt;")],
  ["paid post has Read-the-full CTA", xml.includes("Read the full post on Skimflow")],
  ["free post has NO CTA", !xml.split("<item>")[1].includes("Read the full post on Skimflow")],
  ["picture teaser embeds free image", xml.includes('<img src="https://img/x?a=1&amp;b=2"')],
  ["agent teaser uses generated block", xml.includes("Free onboarding &amp; pricing.")],
  ["dangerous ]]> neutralized", xml.includes("]]]]><![CDATA[>") && !/Teaser with[^]]*?]]>(?!]?<!\[CDATA)/.test(xml)],
  ["balanced CDATA open/close", (xml.match(/<!\[CDATA\[/g) || []).length === (xml.match(/\]\]>/g) || []).length],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
}
console.log("\n----- rendered feed -----\n");
console.log(xml);
if (failed) {
  console.error(`\n✗ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\n✓ All RSS structural checks passed.");
