"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/Toaster";
import PayoutWallet from "@/components/PayoutWallet";

const MAX_NAME = 32;
const MAX_HANDLE = 24;
const MAX_BIO = 160;

interface Initial {
  displayName: string;
  handle: string;
  bio: string;
  avatar: string | null;
  email: string;
}

/** Slugify a handle the same way the server does, for live preview. */
function slugifyHandle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_HANDLE);
}

export default function ProfileSettings({ initial, impersonating }: { initial: Initial; impersonating: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Where to go on "back". Prefer an explicit ?returnTo=, but only honor an
  // internal same-site path (a leading "/" that isn't "//") to avoid open
  // redirects. Fall back to the dashboard.
  const rawReturn = searchParams.get("returnTo");
  const returnTo = rawReturn && /^\/(?!\/)/.test(rawReturn) ? rawReturn : "/dashboard";
  const backLabel = returnTo === "/dashboard" ? "Dashboard" : "Back";
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [handleInput, setHandleInput] = useState(initial.handle);
  const [bio, setBio] = useState(initial.bio);
  const [busy, setBusy] = useState(false);

  const handle = slugifyHandle(handleInput);
  const nameOk = displayName.trim().length > 0 && displayName.length <= MAX_NAME;
  const handleOk = handle.length >= 3;
  const disabled = impersonating || busy || !nameOk || !handleOk;

  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/creator/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim(), handle, bio: bio.trim() }),
      });
      const d = await r.json();
      if (r.ok) {
        toast("success", "Profile saved.");
        setHandleInput(d.handle ?? handle);
      } else {
        toast("error", d.friendly ?? d.error ?? "Couldn't save profile.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display-lg text-display-lg-mobile">Profile settings</h1>
        <Link href={returnTo} className="font-label-caps text-label-caps text-outline hover:text-primary">
          ← {backLabel}
        </Link>
      </div>

      {impersonating && (
        <p className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3 font-body-sm text-primary">
          Read-only while impersonating — profile changes are disabled.
        </p>
      )}

      <div className="card flex flex-col gap-5">
        <div className="flex items-center gap-3">
          {initial.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={initial.avatar} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 font-headline-sm text-primary">
              {(displayName || initial.email || "?").trim().charAt(0).toUpperCase()}
            </span>
          )}
          <div className="font-body-sm text-on-surface-variant">{initial.email}</div>
        </div>

        <Field label="Display name" hint={`${displayName.length}/${MAX_NAME}`}>
          <input
            value={displayName}
            maxLength={MAX_NAME}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-lg border border-outline px-3 py-2 text-body-md focus:border-primary focus:outline-none"
          />
        </Field>

        <Field label="Handle" hint={`${handle.length}/${MAX_HANDLE}`}>
          <div className="flex items-center gap-2">
            <span className="font-data-mono text-on-surface-variant">@</span>
            <input
              value={handleInput}
              maxLength={MAX_HANDLE + 8}
              onChange={(e) => setHandleInput(e.target.value)}
              placeholder="your_handle"
              className="w-full rounded-lg border border-outline px-3 py-2 font-data-mono text-body-md focus:border-primary focus:outline-none"
            />
          </div>
          <p className="mt-1 font-body-sm text-[12px] text-on-surface-variant">
            Public profile: <span className="font-data-mono">@{handle || "…"}</span>
            {!handleOk && handleInput && <span className="text-primary"> · at least 3 letters/numbers</span>}
          </p>
        </Field>

        <Field label="Bio" hint={`${bio.length}/${MAX_BIO}`}>
          <textarea
            value={bio}
            maxLength={MAX_BIO}
            rows={3}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A short line about you (shown on your profile)."
            className="w-full rounded-lg border border-outline px-3 py-2 text-body-md focus:border-primary focus:outline-none"
          />
        </Field>

        <div className="flex justify-end">
          <button onClick={save} disabled={disabled} className="btn-primary px-6 py-2">
            {busy ? "Saving…" : "Save profile"}
          </button>
        </div>
      </div>

      {!impersonating && <PayoutWallet />}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-label-caps text-label-caps text-on-surface-variant">{label}</span>
        {hint && <span className="font-data-mono text-[11px] text-outline">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
