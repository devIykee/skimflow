/**
 * Compact "time ago" formatting for social timestamps (feed, comments,
 * notifications). Client-safe, dependency-free. Falls back to a locale date for
 * anything older than ~30 days.
 */
export function timeAgo(input: string | number | Date): string {
  const then = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (!Number.isFinite(then)) return "";
  const secs = Math.floor((Date.now() - then) / 1000);

  if (secs < 45) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString();
}
