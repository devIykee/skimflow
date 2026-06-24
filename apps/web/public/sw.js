/*
 * Skimflow service worker — offline support.
 *
 *  • App shell precached on install; bump CACHE_V<n> to invalidate.
 *  • Static assets   → cache-first  (instant, offline-capable).
 *  • API calls (GET) → network-first, falling back to the last cached response.
 *  • Navigations     → network-first, falling back to the cached app shell.
 *  • Offline writes  → the app queues requests in IndexedDB and the page asks
 *    for a Background Sync; this SW replays them on `sync` ('sync-drafts').
 *
 * Hand-written (no Workbox in the project).
 */
const CACHE = "skimflow-cache-v2";
const PRECACHE = ["/", "/offline", "/icon.svg", "/logo.svg", "/manifest.webmanifest"];

// ── Lifecycle ────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // Resilient: cache each URL independently so one failure (e.g. a 404 or a
      // transient hiccup) can't abort the whole install and leave us with no
      // offline cache at all.
      await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" }))));
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch strategies ─────────────────────────────────────────────────────────
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) {
    const cache = await caches.open(CACHE);
    cache.put(req, res.clone());
  }
  return res;
}

async function networkFirst(req, fallbackUrl) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (fallbackUrl) {
      const shell = await caches.match(fallbackUrl);
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // writes are queued by the app, not cached
  const url = new URL(req.url);

  // Google Fonts (cross-origin) — cache-first so they work offline once seen.
  if (url.origin !== self.location.origin) {
    if (/fonts\.(googleapis|gstatic)\.com$/.test(url.host)) event.respondWith(cacheFirst(req));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(req));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    /\.(css|js|woff2?|ttf|otf|svg|png|jpe?g|gif|webp|ico)$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(req));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(handleNavigation(req));
    return;
  }
});

// Navigations: try the network, then the exact cached page, then the home shell,
// then the guaranteed-static offline page — so a navigation ALWAYS resolves to
// something rather than the browser's dinosaur.
async function handleNavigation(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return (
      (await caches.match(req)) ||
      (await caches.match("/")) ||
      (await caches.match("/offline")) ||
      new Response("You are offline.", { status: 503, headers: { "Content-Type": "text/plain" } })
    );
  }
}

// ── Background Sync: replay queued offline writes ────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-drafts") event.waitUntil(replayQueuedRequests());
});

// Also flush when the page explicitly asks (e.g. on 'online' in browsers
// without Background Sync support).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "flush-drafts") event.waitUntil(replayQueuedRequests());
});

async function replayQueuedRequests() {
  const reqs = await idbGetAll();
  let synced = 0;
  for (const r of reqs) {
    try {
      const res = await fetch(r.url, {
        method: r.method,
        headers: { "content-type": "application/json" },
        body: r.body,
        credentials: "same-origin",
      });
      if (res.ok) {
        await idbDelete(r.id);
        synced++;
      }
      // non-ok (e.g. 401/validation) → leave it queued for the next attempt
    } catch {
      // still offline / transient — stop; Background Sync will retry the tag
      break;
    }
  }
  if (synced > 0) {
    const clients = await self.clients.matchAll();
    clients.forEach((c) => c.postMessage({ type: "drafts-synced", count: synced }));
  }
}

// ── Minimal IndexedDB (shared store with the app: see lib/offline-drafts.ts) ──
const DB_NAME = "skimflow-offline";
const DB_VERSION = 1;
const STORE = "pending-requests";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) {
        open.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function idbGetAll() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
