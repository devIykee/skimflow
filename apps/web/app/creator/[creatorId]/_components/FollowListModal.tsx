"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import FollowButton from "@/components/FollowButton";

interface UserRow {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  bio: string | null;
}

/** Modal listing a creator's followers or the accounts they follow. */
export default function FollowListModal({
  userId,
  type,
  onClose,
}: {
  userId: string;
  type: "followers" | "following";
  onClose: () => void;
}) {
  const [users, setUsers] = useState<UserRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/follows/${userId}/list?type=${type}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setUsers(d?.users ?? []))
      .catch(() => alive && setUsers([]));
    return () => {
      alive = false;
    };
  }, [userId, type]);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEsc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-outline-variant bg-surface"
      >
        <div className="flex items-center justify-between border-b border-outline-variant px-4 py-3">
          <span className="font-headline-sm text-[15px] font-semibold capitalize">{type}</span>
          <button onClick={onClose} aria-label="Close" className="text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="overflow-y-auto">
          {users === null && <p className="px-4 py-6 font-body-sm text-on-surface-variant">Loading…</p>}
          {users !== null && users.length === 0 && (
            <p className="px-4 py-8 text-center font-body-sm text-on-surface-variant">
              {type === "followers" ? "No followers yet." : "Not following anyone yet."}
            </p>
          )}
          {(users ?? []).map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3">
              <Link href={`/creator/${u.id}`} onClick={onClose} className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-90">
                {u.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-label-caps text-[13px] text-primary">
                    {u.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate font-body-sm text-[14px] font-semibold text-on-surface">{u.name}</span>
                  {u.handle && <span className="truncate font-data-mono text-[12px] text-outline">@{u.handle}</span>}
                </span>
              </Link>
              <FollowButton userId={u.id} name={u.name} size="sm" />
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
