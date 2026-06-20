/**
 * Content-import ownership verification.
 *
 * Proves the importing creator actually owns the source they pulled in:
 *   • GitHub  → the repo/gist owner equals their GitHub OAuth username.
 *   • X / Substack / Medium → they place a one-time `verify_code` in their public
 *     profile bio; we fetch the profile and confirm the code is present.
 *
 * All checks are run SERVER-SIDE (the publish route never trusts a client flag).
 */

export type SourcePlatform = "github" | "x" | "substack" | "medium" | "other";
export type VerifiedVia = "github_oauth" | "bio_code";

export interface PlatformInfo {
  platform: SourcePlatform;
  /** The account handle the URL belongs to (repo owner, @handle, subdomain). */
  authorHandle: string | null;
  /** Public profile/bio URL we can fetch to look for a verification code. */
  profileUrl: string | null;
}

/** Identify the source platform + author handle from an imported URL. */
export function detectPlatform(rawUrl: string): PlatformInfo {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { platform: "other", authorHandle: null, profileUrl: null };
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const segs = u.pathname.split("/").filter(Boolean);

  // GitHub: github.com/<owner>/... , raw.githubusercontent.com/<owner>/... , gist.
  if (host === "github.com" || host === "raw.githubusercontent.com" || host === "gist.github.com") {
    const owner = segs[0] ?? null;
    return { platform: "github", authorHandle: owner, profileUrl: owner ? `https://github.com/${owner}` : null };
  }

  // X / Twitter: x.com/<handle>/... , twitter.com/<handle>/...
  if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com") {
    const handle = segs[0] && !["i", "home", "search", "hashtag"].includes(segs[0]) ? segs[0] : null;
    return { platform: "x", authorHandle: handle, profileUrl: handle ? `https://x.com/${handle}` : null };
  }

  // Substack: <pub>.substack.com or custom domains we can't infer → use the about page.
  if (host.endsWith(".substack.com")) {
    const sub = host.replace(".substack.com", "");
    return { platform: "substack", authorHandle: sub, profileUrl: `https://${host}/about` };
  }

  // Medium: medium.com/@handle/... or <handle>.medium.com
  if (host === "medium.com") {
    const handle = segs[0]?.startsWith("@") ? segs[0].slice(1) : null;
    return { platform: "medium", authorHandle: handle, profileUrl: handle ? `https://medium.com/@${handle}/about` : null };
  }
  if (host.endsWith(".medium.com")) {
    const handle = host.replace(".medium.com", "");
    return { platform: "medium", authorHandle: handle, profileUrl: `https://${host}/about` };
  }

  return { platform: "other", authorHandle: null, profileUrl: null };
}

/** Generate a fresh per-user verification code (placed in the creator's bio). */
export function newVerifyCode(seed: string): string {
  // No Math.random (sandbox-safe): derive from a high-res-ish seed.
  const h = Buffer.from(`${seed}|${process.hrtime.bigint().toString(36)}`).toString("base64url").replace(/[^a-z0-9]/gi, "").slice(0, 10).toLowerCase();
  return `linepay-verify-${h}`;
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 3_000_000;

/** Fetch a public profile page and return its lowercased text (or null). */
async function fetchProfileText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "LinePayCite-Verifier/1.0 (+https://linepay.cite)" },
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return new TextDecoder().decode(buf.slice(0, MAX_BYTES)).toLowerCase();
    return new TextDecoder().decode(buf).toLowerCase();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface VerifyResult {
  platform: SourcePlatform;
  authorHandle: string | null;
  verified: boolean;
  via: VerifiedVia | null;
  /** Human-readable explanation / next step. */
  reason: string;
  /** For bio-code platforms: the code to paste + where. */
  code?: string;
  profileUrl?: string | null;
  instructions?: string;
}

export interface VerifyInput {
  url: string;
  /** The creator's GitHub OAuth username, if linked. */
  githubUsername: string | null;
  /** The creator's per-user verification code (for bio-code platforms). */
  verifyCode: string;
}

/**
 * Master switch for ownership verification. Defaults ON. Set
 * OWNERSHIP_VERIFICATION_ENABLED=0 to disable everywhere (non-blocking).
 */
function verificationEnabled(): boolean {
  return process.env.OWNERSHIP_VERIFICATION_ENABLED !== "0";
}

/**
 * X (Twitter) bio-code verification is currently non-functional: the public
 * profile page is a JS-only SPA with no server-rendered bio text, so the code
 * can never be found server-side. Until we move to the X API, X verification is
 * gated off and treated as "unavailable" (non-blocking) rather than failing.
 */
function xVerificationEnabled(): boolean {
  return process.env.X_VERIFICATION_ENABLED === "1";
}

/** Verify that the creator owns the imported source. */
export async function verifyOwnership(input: VerifyInput): Promise<VerifyResult> {
  const info = detectPlatform(input.url);
  const base = { platform: info.platform, authorHandle: info.authorHandle, profileUrl: info.profileUrl };

  // Global kill-switch — never block publishing on verification when off.
  if (!verificationEnabled()) {
    return {
      ...base,
      verified: false,
      via: null,
      reason: "Ownership verification is temporarily disabled — you can still publish.",
    };
  }

  // X bio-code check can't work against the SPA; gate it off (non-blocking).
  if (info.platform === "x" && !xVerificationEnabled()) {
    return {
      ...base,
      verified: false,
      via: null,
      reason:
        "X ownership verification is temporarily unavailable. You can still import and publish the post.",
    };
  }

  if (info.platform === "github") {
    if (!input.githubUsername) {
      return { ...base, verified: false, via: null, reason: "Sign in with GitHub to verify GitHub sources." };
    }
    if (!info.authorHandle) {
      return { ...base, verified: false, via: null, reason: "Couldn't read the repository owner from that URL." };
    }
    const ok = info.authorHandle.toLowerCase() === input.githubUsername.toLowerCase();
    return {
      ...base,
      verified: ok,
      via: ok ? "github_oauth" : null,
      reason: ok
        ? `Verified — the repo belongs to @${input.githubUsername} (your GitHub login).`
        : `That repo is owned by @${info.authorHandle}, but you signed in as @${input.githubUsername}.`,
    };
  }

  if (info.platform === "x" || info.platform === "substack" || info.platform === "medium") {
    if (!info.profileUrl) {
      return { ...base, verified: false, via: null, code: input.verifyCode, reason: "Couldn't determine your profile URL from that link." };
    }
    const text = await fetchProfileText(info.profileUrl);
    const instructions = `Add this code anywhere in your ${labelFor(info.platform)} profile/bio, then re-check: ${input.verifyCode}`;
    if (text == null) {
      return {
        ...base,
        verified: false,
        via: null,
        code: input.verifyCode,
        instructions,
        reason: `Couldn't reach your ${labelFor(info.platform)} profile (${info.profileUrl}). Make sure it's public, then re-check.`,
      };
    }
    const ok = text.includes(input.verifyCode.toLowerCase());
    return {
      ...base,
      verified: ok,
      via: ok ? "bio_code" : null,
      code: input.verifyCode,
      instructions: ok ? undefined : instructions,
      reason: ok
        ? `Verified — found your code in your ${labelFor(info.platform)} bio.`
        : `Code not found in your ${labelFor(info.platform)} bio yet.`,
    };
  }

  return { ...base, verified: false, via: null, reason: "This source can't be ownership-verified, but you can still publish it." };
}

function labelFor(p: SourcePlatform): string {
  return p === "x" ? "X" : p === "github" ? "GitHub" : p === "substack" ? "Substack" : p === "medium" ? "Medium" : "source";
}
