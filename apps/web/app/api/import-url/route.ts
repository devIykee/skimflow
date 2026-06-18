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

    const source = detectPlatform(target.toString());

    // Raw markdown path.
    if (isRawMarkdown(target)) {
      const fallback = target.pathname.split("/").pop() ?? "Imported document";
      return Response.json({
        title: titleFromMarkdown(text, fallback.replace(/\.(md|markdown)$/i, "")),
        content: text,
        format: "markdown",
        sourceUrl: target.toString(),
        sourcePlatform: source.platform,
        authorHandle: source.authorHandle,
      });
    }

    // HTML article path — Readability + Turndown.
    const dom = new JSDOM(text, { url: target.toString() });
    const article = new Readability(dom.window.document).parse();
    if (!article || !article.content) {
      return Response.json({ error: "could_not_extract", message: "No readable article content found at that URL." }, { status: 422 });
    }
    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    const markdown = turndown.turndown(article.content);

    return Response.json({
      title: (article.title ?? dom.window.document.title ?? "Imported article").trim(),
      content: markdown,
      format: "article",
      sourceUrl: target.toString(),
      sourcePlatform: source.platform,
      authorHandle: source.authorHandle,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
