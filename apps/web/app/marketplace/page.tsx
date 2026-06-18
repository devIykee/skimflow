import { redirect } from "next/navigation";

// The marketplace was renamed to "For You". Keep this path working for old
// links, bookmarks, and agents that discovered "/marketplace".
export default function MarketplaceRedirect() {
  redirect("/for-you");
}
