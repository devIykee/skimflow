import { NextRequest } from "next/server";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { requireUser, errorResponse } from "@/lib/session";
import { envLimit, rateLimit, rateLimitResponse, clientIp } from "@/lib/rate-limit";
import { detectPlatform } from "@/lib/ownership";

export const runtime = "nodejs";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 5_000_000; // 5 MB cap

/** Block obvious SSRF targets (localhost / link-local / private literals). */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) return true;
  if (/^(127\.|10\.|169\.254\.|192\.168\.|0\.0\.0\.0)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

function isRawMarkdown(u: URL): boolean {
  return (
    u.pathname.toLowerCase().endsWith(".md") ||
    u.pathname.toLowerCase().endsWith(".markdown") ||
    u.hostname === "raw.githubusercontent.com"
  );
}

function titleFromMarkdown(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return (m?.[1] ?? fallback).trim();
}

/** Extract a tweet/post id from an x.com / twitter.com status URL. */
function tweetIdFromUrl(u: URL): string | null {
  const m = u.pathname.match(/\/status(?:es)?\/(\d+)/);
  return m?.[1] ?? null;
}

/** Token the public syndication endpoint expects (same scheme react-tweet uses). */
function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

interface SyndicationTweet {
  text?: string;
  user?: { name?: string; screen_name?: string };
  photos?: Array<{ url?: string }>;
  tombstone?: unknown;
}

/** Fetch a single X post via Circle-free public syndication CDN. */
async function fetchTweet(id: string): Promise<{ ok: true; markdown: string; title: string; handle: string | null } | { ok: false; reason: string }> {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${syndicationToken(id)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LinePayCite/1.0; +https://linepay.cite)" },
    });
  } catch {
    return { ok: false, reason: "x_fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) return { ok: false, reason: "x_post_not_found" };
  if (!res.ok) return { ok: false, reason: "x_unavailable" };
  let data: SyndicationTweet;
  try {
    data = (await res.json()) as SyndicationTweet;
  } catch {
    return { ok: false, reason: "x_bad_response" };
  }
  const text = (data.text ?? "").trim();
  if (data.tombstone || !text) return { ok: false, reason: "x_post_unavailable" };

  const handle = data.user?.screen_name ?? null;
  const name = data.user?.name ?? handle ?? "Unknown";
  const photos = (data.photos ?? []).map((p) => p.url).filter(Boolean) as string[];
  const md =
    `${text}\n\n` +
    photos.map((u) => `![](${u})`).join("\n\n") +
    (photos.length ? "\n\n" : "") +
    `— **${name}**${handle ? ` (@${handle})` : ""} on X`;
  const firstLine = text.split("\n")[0].slice(0, 70).trim();
  const title = firstLine.length >= 8 ? firstLine : `Post by @${handle ?? "x"}`;
  return { ok: true, markdown: md.trim(), title, handle };
}

/**
 * POST /api/import-url  { url }
 * Fetches remote content (Substack, Medium, X/Twitter, raw GitHub .md, any
 * article URL) and returns readable text:
 *   - .md / raw GitHub → raw text, format 'markdown'
 *   - HTML article     → Readability-extracted, converted to markdown, 'article'
 */
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req.headers);
    const rl = await rateLimit({ key: `import:${ip}`, limit: envLimit("RATE_LIMIT_IMPORT", 10), windowSec: 60 });
    if (!rl.ok) return rateLimitResponse(rl);

    // Importing is a creator action — require auth (and prevent open-proxy abuse).
    await requireUser();

    const { url } = (await req.json().catch(() => ({}))) as { url?: string };
    if (!url || typeof url !== "string") {
      return Response.json({ error: "missing_url" }, { status: 400 });
    }

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return Response.json({ error: "invalid_url" }, { status: 400 });
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return Response.json({ error: "unsupported_protocol" }, { status: 400 });
    }
    if (isBlockedHost(target.hostname)) {
      return Response.json({ error: "blocked_host" }, { status: 400 });
    }

    const source = detectPlatform(target.toString());

    // ── X / Twitter posts: use the syndication API, not page scraping ─────────
    if (source.platform === "x") {
      const id = tweetIdFromUrl(target);
      if (!id) {
        return Response.json(
          { error: "x_needs_post", message: "Paste a link to a specific X post (…/status/123…), not a profile." },
          { status: 422 }
        );
      }
      const tweet = await fetchTweet(id);
      if (!tweet.ok) {
        const message =
          tweet.reason === "x_post_not_found"
            ? "That X post wasn't found (it may be deleted or from a protected account)."
            : "Couldn't load that X post — it may be protected, deleted, or temporarily unavailable.";
        return Response.json({ error: tweet.reason, message }, { status: 422 });
      }
      return Response.json({
        title: tweet.title,
        content: tweet.markdown,
        format: "article",
        contentType: "x-post",
        sourceUrl: target.toString(),
        sourcePlatform: "x",
        authorHandle: tweet.handle ?? source.authorHandle,
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(target.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "LinePayCite-Importer/1.0 (+https://linepay.cite)" },
      });
    } catch {
      return Response.json({ error: "fetch_failed" }, { status: 502 });
    } finally {
      clearTimeout(timer);
    }
    if (!upstream.ok) {
      return Response.json({ error: "upstream_error", status: upstream.status }, { status: 502 });
    }

    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return Response.json({ error: "content_too_large" }, { status: 413 });
    }
    const text = new TextDecoder().decode(buf);

    // Raw markdown path (.md / raw GitHub) → treat as an agent-skills doc.
    if (isRawMarkdown(target)) {
      if (text.trim().length < 40) {
        return Response.json({ error: "empty_document", message: "That file looks empty." }, { status: 422 });
      }
      const fallback = target.pathname.split("/").pop() ?? "Imported document";
      return Response.json({
        title: titleFromMarkdown(text, fallback.replace(/\.(md|markdown)$/i, "")),
        content: text,
        format: "markdown",
        contentType: "agent-skills",
        sourceUrl: target.toString(),
        sourcePlatform: source.platform,
        authorHandle: source.authorHandle,
      });
    }

    // HTML article path — Readability + Turndown.
    const dom = new JSDOM(text, { url: target.toString() });
    const article = new Readability(dom.window.document).parse();
    // Reject pages that aren't real articles (login walls, link dumps, SPAs that
    // render nothing server-side, etc.) so garbage never lands in the feed.
    const wordCount = (article?.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
    if (!article || !article.content || wordCount < 50) {
      return Response.json(
        {
          error: "not_an_article",
          message:
            "Couldn't find a real article at that URL. Make sure it's a public post/article page (not a homepage, login wall, or feed).",
        },
        { status: 422 }
      );
    }
    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    const markdown = turndown.turndown(article.content);

    return Response.json({
      title: (article.title ?? dom.window.document.title ?? "Imported article").trim(),
      content: markdown,
      format: "article",
      contentType: "article",
      sourceUrl: target.toString(),
      sourcePlatform: source.platform,
      authorHandle: source.authorHandle,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
