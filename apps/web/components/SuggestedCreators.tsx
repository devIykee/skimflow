"use client";

import Link from "next/link";
import FollowButton from "@/components/FollowButton";

export interface SuggestedCreator {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  bio: string | null;
}

/**
 * Horizontally-scrollable row of creator cards (avatar, name, one-line bio,
 * follow button). Reused in the following-feed empty state and injected into
 * the feed to grow the social graph.
 */
export default function SuggestedCreators({
  creators,
  title = "Suggested for you",
  onFollowed,
}: {
  creators: SuggestedCreator[];
  title?: string;
  onFollowed?: () => void;
}) {
  if (creators.length === 0) return null;
  return (
    <section className="my-2">
      <h3 className="mb-3 font-label-caps text-label-caps text-on-surface-variant">{title}</h3>
      <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {creators.map((c) => (
          <div
            key={c.id}
            className="flex w-52 shrink-0 flex-col items-center gap-2 rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 text-center"
          >
            <Link href={`/creator/${c.id}`} className="flex flex-col items-center gap-2 hover:opacity-90">
              <Avatar name={c.name} src={c.avatarUrl} />
              <span className="min-w-0">
                <span className="block truncate font-body-sm text-[14px] font-semibold text-on-surface">{c.name}</span>
                {c.handle && <span className="block truncate font-data-mono text-[11px] text-outline">@{c.handle}</span>}
              </span>
            </Link>
            {c.bio && <p className="line-clamp-2 font-body-sm text-[12px] text-on-surface-variant">{c.bio}</p>}
            <FollowButton
              userId={c.id}
              name={c.name}
              initialFollowing={false}
              size="sm"
              onChange={(f) => f && onFollowed?.()}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function Avatar({ name, src }: { name: string; src: string | null }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="h-14 w-14 rounded-full object-cover" />;
  }
  return (
    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 font-headline-sm text-[20px] text-primary">
      {(name || "?").trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
