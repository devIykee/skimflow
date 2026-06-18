/**
 * Node preload (loaded via `node --import`) that pins every outbound `fetch`
 * onto IPv4. Used only for local dev (wired up in scripts/dev.sh).
 *
 * Why: Node's built-in fetch (undici) does not fall back from IPv6 to IPv4. On
 * hosts where DNS returns a AAAA record but the IPv6 route is dead (common on
 * WSL2), undici connects to the v6 address and hangs until ETIMEDOUT — which
 * surfaced as `TypeError: fetch failed` during OAuth → NextAuth
 * `?error=Configuration` (HTTP 500) on sign-in.
 *
 * This must run as a Node preload rather than Next's instrumentation.ts:
 * importing `undici` inside instrumentation makes Next's bundler try to bundle
 * it for the edge runtime, which fails on `crypto`. A preload bypasses the
 * bundler entirely. Disable with UNDICI_FORCE_IPV4=0.
 */
if (process.env.UNDICI_FORCE_IPV4 !== "0") {
  const { setGlobalDispatcher, Agent } = await import("undici");
  setGlobalDispatcher(new Agent({ connect: { family: 4 } }));
}
