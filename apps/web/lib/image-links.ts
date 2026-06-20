/**
 * Skim-Flow image links (§5a). Images are pasted as links, not uploaded. Google
 * Drive *share* links don't render as a raw <img>, so we normalize them to a
 * direct-content URL. Other hosts are accepted as-is (the actual image load in
 * the browser is the real validity check). No Imgur/Dropbox special-casing.
 */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?.*)?$/i;

/** Extract a Google Drive file id from the common share-link shapes. */
function driveFileId(u: URL): string | null {
  const byPath = u.pathname.match(/\/file\/d\/([^/]+)/);
  if (byPath) return byPath[1];
  const byQuery = u.searchParams.get("id");
  if (byQuery) return byQuery;
  return null;
}

/**
 * Convert a Drive share link to a direct-view URL; return other URLs unchanged.
 * Returns the input string untouched if it isn't a valid URL.
 */
export function normalizeImageUrl(raw: string): string {
  const trimmed = (raw ?? "").trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  const host = u.hostname.toLowerCase();
  if (host === "drive.google.com" || host === "docs.google.com") {
    const id = driveFileId(u);
    if (id) return `https://drive.google.com/uc?export=view&id=${id}`;
  }
  return trimmed;
}

/** Cheap heuristic: a direct image extension or a normalized Drive view link. */
export function isLikelyImageUrl(raw: string): boolean {
  const url = normalizeImageUrl(raw);
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (IMAGE_EXT.test(u.pathname)) return true;
    if (u.hostname.toLowerCase() === "drive.google.com" && u.searchParams.get("export") === "view") return true;
    // Many CDNs serve images without an extension — allow https URLs through and
    // let the browser <img> load be the real check at paste time.
    return true;
  } catch {
    return false;
  }
}

export const MAX_SKIMFLOW_IMAGES = 30;
export const MAX_CAPTION_CHARS = 280;
