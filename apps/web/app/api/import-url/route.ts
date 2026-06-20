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

/**
 * Rewrite a GitHub *blob* page URL to its raw content URL. A `github.com/<o>/
 * <r>/blob/<ref>/<path>` link serves the full HTML page (nav, sidebars, ~280 KB
 * of chrome) — fetching that and treating it as markdown produced garbage. The
 * raw host serves the file bytes directly. Returns the original URL untouched
 * when it isn't a recognizable blob URL.
 */
function toRawGitHub(u: URL): URL {
  const host = u.hostname.toLowerCase();
  if (host === "github.com") {
    // /<owner>/<repo>/blob/<ref>/<...path>
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (m) {
      const raw = new URL(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`);
      raw.search = ""; // strip ?plain=1 etc.
      return raw;
    }
  }
  if (host === "gist.github.com") {
    // /<user>/<id> → raw endpoint serves the concatenated file content.
    const m = u.pathname.match(/^\/[^/]+\/[0-9a-f]+/i);
    if (m) return new URL(`https://gist.githubusercontent.com${m[0]}/raw`);
  }
  return u;
}

/** A real browser-ish UA, and a Googlebot UA used as a fallback for bot walls. */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

/**
 * Publishers (Medium, Substack) lazy-load images: the real URL sits in
 * `data-src` / `data-srcset` / `srcset` while `src` is a 1px placeholder or
 * empty. Readability + Turndown only read `src`, so without this the imported
 * markdown gets blank/placeholder images. Promote the best real URL into `src`
 * so it survives into `![](…)`.
 */
function normalizeLazyImages(doc: Document): void {
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const pick = (val: string | null): string | null => {
      if (!val) return null;
      // srcset → take the first (usually largest/first candidate) URL.
      const first = val.split(",")[0]?.trim().split(/\s+/)[0];
      return first || null;
    };
    const current = img.getAttribute("src") ?? "";
    const isPlaceholder = !current || current.startsWith("data:") || /\b1x1\b|placeholder|spacer/i.test(current);
    if (!isPlaceholder) continue;
    const real =
      img.getAttribute("data-src") ||
      pick(img.getAttribute("data-srcset")) ||
      pick(img.getAttribute("srcset"));
    if (real) img.setAttribute("src", real);
  }
}

function titleFromMarkdown(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return (m?.[1] ?? fallback).trim();
}

/** A paragraph that is nothing but one or more markdown images. */
function isImageOnlyParagraph(p: string): boolean {
  const t = p.trim();
  if (!t) return false;
  return t.split(/\n+/).every((l) => /^!\[[^\]]*\]\([^)]*\)\s*$/.test(l.trim()));
}

/**
 * Medium (and similar) export every image as its own block. Left alone, the
 * article chunker (split on blank lines) turns each image into a standalone
 * image-only chunk — bad reading, and it fails the chunk-min-line rule. Attach
 * each image-only paragraph to the nearest adjacent TEXT paragraph (preceding
 * if present, otherwise the following one) so an image is always media inside a
 * real chunk, never a chunk of its own.
 */
function attachLoneImages(md: string): string {
  const paras = md
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+$/gm, "").trim())
    .filter((p) => p.length > 0);

  const out: string[] = [];
  let leading: string[] = []; // images seen before any text paragraph
  for (const p of paras) {
    if (isImageOnlyParagraph(p)) {
      if (out.length) out[out.length - 1] += "\n" + p; // attach to preceding text
      else leading.push(p); // defer until we hit text
    } else {
      out.push(leading.length ? leading.join("\n") + "\n" + p : p);
      leading = [];
    }
  }
  // Whole doc was images (no text at all) — keep them together as one block.
  if (out.length === 0 && leading.length) out.push(leading.join("\n"));
  else if (leading.length) out[out.length - 1] += "\n" + leading.join("\n");
  return out.join("\n\n");
}

/** Medium UI artifacts and membership/signup chrome to strip from imports. */
const MEDIUM_BOILERPLATE: RegExp[] = [
  /press enter or click to view image in full size/i,
  /stories in your inbox/i,
  /join medium for free/i,
  /remember me for faster sign in/i,
  /^get\b.*\bin your inbox$/i,
  /^sign (up|in)$/i,
  /^follow$/i,
];

function stripMediumBoilerplate(md: string): string {
  const kept = md.split("\n").filter((line) => {
    const t = line.trim();
    if (!t) return true;
    return !MEDIUM_BOILERPLATE.some((re) => re.test(t));
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Parse leading `--- … ---` frontmatter into a flat key→value map + the body. */
function parseFrontmatter(md: string): { data: Record<string, string>; body: string } {
  const m = md.match(/^﻿?---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: md };
  const data: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (mm) data[mm[1].toLowerCase()] = mm[2].trim().replace(/^["']|["']$/g, "");
  }
  return { data, body: md.slice(m[0].length) };
}

/** `[a, b]` or `a, b` → `a, b` (comma-separated, brackets/quotes stripped). */
function normalizeTags(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((t) => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
    .join(", ");
}

/**
 * POST /api/import-url  { url }
 * Supports exactly two sources:
 *   - GitHub `.md` (raw or blob) → an Agent Skill (format 'markdown'), with
 *     frontmatter mapped to title/summary/tags.
 *   - Medium / article HTML      → Readability-extracted, converted to markdown,
 *     images attached to adjacent text, Medium boilerplate stripped ('article').
 * X/Twitter import was retired — users copy-paste X content into the editor.
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

    // ── X / Twitter import retired — copy-paste into the editor instead ───────
    if (source.platform === "x") {
      return Response.json(
        {
          error: "x_import_removed",
          message:
            "X posts aren't imported. Copy the post text and paste it into the editor below — it publishes as a single chunk.",
        },
        { status: 422 }
      );
    }

    // GitHub blob pages serve HTML chrome, not file content — fetch the raw URL
    // instead. Keep the original URL for provenance (sourceUrl below).
    const fetchTarget = toRawGitHub(target);

    // Fetch with a real browser UA; if a bot wall blocks it (403, or a tiny
    // Cloudflare interstitial), retry once as Googlebot, which Medium/Substack
    // and most publishers allow through for SEO.
    async function fetchOnce(ua: string): Promise<Response | null> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        return await fetch(fetchTarget.toString(), {
          signal: controller.signal,
          redirect: "follow",
          headers: { "User-Agent": ua },
        });
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }

    // Medium/Substack render almost nothing for a normal browser UA but serve
    // the full server-rendered article to Googlebot (verified: 515 vs 198 words
    // on a real Medium post). For those, lead with Googlebot. Everything else
    // leads with a browser UA and falls back to Googlebot only when blocked.
    const preferBot = source.platform === "medium" || source.platform === "substack";
    let upstream = await fetchOnce(preferBot ? GOOGLEBOT_UA : BROWSER_UA);
    if (!upstream || upstream.status === 403 || upstream.status === 429) {
      const retry = await fetchOnce(preferBot ? BROWSER_UA : GOOGLEBOT_UA);
      if (retry) upstream = retry;
    }
    if (!upstream) {
      return Response.json({ error: "fetch_failed" }, { status: 502 });
    }
    if (!upstream.ok) {
      return Response.json({ error: "upstream_error", status: upstream.status }, { status: 502 });
    }

    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return Response.json({ error: "content_too_large" }, { status: 413 });
    }
    const text = new TextDecoder().decode(buf);

    // Raw markdown path (.md / raw GitHub) → an Agent Skill. Map frontmatter to
    // title/summary/tags; if name/description are missing, flag needsMetadata so
    // the editor requires the creator to fill them before publishing (no
    // silently-incomplete skills) rather than blocking the import outright.
    if (isRawMarkdown(fetchTarget)) {
      if (text.trim().length < 40) {
        return Response.json({ error: "empty_document", message: "That file looks empty." }, { status: 422 });
      }
      const fallback = (target.pathname.split("/").pop() ?? "Imported document").replace(/\.(md|markdown)$/i, "");
      const { data } = parseFrontmatter(text);
      const title = (data.name || data.title || titleFromMarkdown(text, fallback)).trim();
      const summary = data.description || data.summary || "";
      const tags = normalizeTags(data.tags);
      const needsMetadata = !data.name && !data.title ? true : !data.description && !data.summary;
      return Response.json({
        title,
        content: text,
        summary,
        tags,
        format: "markdown",
        contentType: "agent-skills",
        needsMetadata,
        sourceUrl: target.toString(),
        sourcePlatform: source.platform,
        authorHandle: source.authorHandle,
      });
    }

    // HTML article path — Readability + Turndown.
    const dom = new JSDOM(text, { url: fetchTarget.toString() });
    normalizeLazyImages(dom.window.document);
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
    const rawMarkdown = turndown.turndown(article.content);
    // Post-process: drop Medium platform chrome, then make sure no image stands
    // alone as its own paragraph (so it can't become an image-only chunk).
    const markdown = attachLoneImages(stripMediumBoilerplate(rawMarkdown));

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
