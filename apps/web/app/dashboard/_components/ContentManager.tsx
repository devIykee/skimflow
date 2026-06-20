"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toaster";
import { useEmbeddedWallet } from "@/lib/useEmbeddedWallet";

interface ContentRow {
  id: string;
  title: string;
  slug: string;
  content_type: string;
  price_per_block: string;
  status: string;
}
interface Preview {
  payableBlocks: number;
  blocks: { index: number; preview: string; length: number }[];
  split: {
    readerPays: string;
    creator: { amount: string; pct: number };
    platform: { amount: string; pct: number };
    referrer: { amount: string; pct: number };
  };
  block0Template?: string;
}

export default function ContentManager({ impersonating }: { impersonating: boolean }) {
  const toast = useToast();
  const embedded = useEmbeddedWallet();
  // A draft saved because the creator had no wallet yet — offer to publish it
  // once a wallet exists.
  const [walletGatedDraft, setWalletGatedDraft] = useState<string | null>(null);
  const [list, setList] = useState<ContentRow[]>([]);
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<"article" | "agent-skills" | "x-post">("article");
  const [body, setBody] = useState("");
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState("");
  const [price, setPrice] = useState("0.05");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [showChunks, setShowChunks] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<{ readerUrl: string; agentUrl?: string } | null>(null);

  // Import provenance + ownership verification (Phase 5).
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourcePlatform, setSourcePlatform] = useState<string | null>(null);
  const [verify, setVerify] = useState<{
    verified: boolean;
    via: string | null;
    reason: string;
    code?: string;
    instructions?: string;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const loadList = useCallback(() => {
    fetch("/api/creator/content", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setList(d.content ?? []))
      .catch(() => {});
  }, []);
  useEffect(loadList, [loadList]);

  // Live commission + chunk preview.
  useEffect(() => {
    if (!body.trim()) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      fetch("/api/creator/content/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, contentType, pricePerBlock: price, title, summary, hasReferrer: true }),
      })
        .then((r) => r.json())
        // Only accept a well-formed preview. If the route returned an error
        // payload (e.g. transient 500), keep the last good preview instead of
        // storing `{error}` — rendering `preview.split` on that would crash.
        .then((d) => {
          if (d && d.split) setPreview(d);
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [body, contentType, price, title, summary]);

  async function doImport() {
    if (!importUrl.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/import-url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl }),
      });
      const d = await r.json();
      if (r.ok) {
        setTitle(d.title ?? title);
        setBody(d.content ?? "");
        setContentType(d.contentType ?? (d.format === "markdown" ? "agent-skills" : "article"));
        setSourceUrl(d.sourceUrl ?? importUrl);
        setSourcePlatform(d.sourcePlatform ?? null);
        setVerify(null);
        toast("success", "Imported — verify ownership, then publish when ready.");
      } else {
        toast("error", d.message ?? d.error ?? "Import failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function doVerify() {
    if (!sourceUrl) return;
    setVerifying(true);
    try {
      const r = await fetch("/api/creator/verify-ownership", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl }),
      });
      const d = await r.json();
      if (r.ok) {
        setVerify(d);
        toast(d.verified ? "success" : "info", d.reason ?? (d.verified ? "Ownership verified." : "Not verified yet."));
      } else {
        toast("error", d.error ?? "Verification failed");
      }
    } finally {
      setVerifying(false);
    }
  }

  async function publish(status: "draft" | "published") {
    setBusy(true);
    setPublished(null);
    try {
      const r = await fetch("/api/creator/content", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, contentType, body, pricePerBlock: price, summary, tags, status, sourceUrl }),
      });
      const d = await r.json();
      if (r.ok && d.walletRequired) {
        // Publish was downgraded to a draft because there's no payout wallet.
        // Keep the editor cleared (the draft is saved) and prompt wallet setup.
        setWalletGatedDraft(d.contentId ?? null);
        setTitle(""); setBody(""); setSummary(""); setTags(""); setPreview(null);
        setSourceUrl(null); setSourcePlatform(null); setVerify(null);
        loadList();
        toast("info", d.message ?? "Saved to drafts — create a wallet to publish.");
      } else if (r.ok) {
        if (status === "published") setPublished({ readerUrl: d.readerUrl, agentUrl: d.agentUrl });
        setTitle(""); setBody(""); setSummary(""); setTags(""); setPreview(null);
        setSourceUrl(null); setSourcePlatform(null); setVerify(null);
        loadList();
        toast(
          "success",
          status === "published" ? "Published — it's live in the For You feed now." : "Draft saved."
        );
      } else {
        toast("error", d.message ?? d.error ?? "Publish failed");
      }
    } finally {
      setBusy(false);
    }
  }

  /** Create the embedded wallet, then publish the gated draft. */
  async function createWalletAndPublish() {
    setBusy(true);
    try {
      await embedded.provision();
      toast("success", "Wallet created.");
      if (walletGatedDraft) {
        const r = await fetch(`/api/creator/content/${walletGatedDraft}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "published" }),
        });
        if (r.ok) {
          setWalletGatedDraft(null);
          loadList();
          toast("success", "Published — it's live in the For You feed now.");
        } else {
          const d = await r.json().catch(() => ({}));
          toast("error", d.message ?? d.error ?? "Wallet created, but publishing the draft failed — try Publish from the table.");
        }
      }
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Couldn't create wallet.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this content?")) return;
    await fetch(`/api/creator/content/${id}`, { method: "DELETE", credentials: "include" });
    loadList();
    toast("info", "Content deleted.");
  }
  async function toggle(id: string, status: string) {
    const next = status === "published" ? "draft" : "published";
    await fetch(`/api/creator/content/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    loadList();
    toast("success", next === "published" ? "Now live in the For You feed." : "Unpublished — hidden from the For You feed.");
  }

  const disabled = impersonating;

  return (
    <div className="flex flex-col gap-6">
      {/* Import */}
      <div className="card">
        <h2 className="mb-3 font-headline-sm text-headline-sm">Import by URL</h2>
        <div className="flex flex-wrap gap-2">
          <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="Substack / Medium / X / raw GitHub .md URL" className="flex-grow rounded-lg border border-outline px-3 py-2 text-body-sm" />
          <button onClick={doImport} disabled={busy || disabled} className="btn-primary px-5 py-2">Import &amp; Monetize</button>
        </div>

        {/* Ownership verification (Phase 5) */}
        {sourceUrl && (
          <div className="mt-4 rounded-lg border border-outline-variant bg-surface-container-low p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-label-caps text-label-caps text-on-surface-variant">
                Source ownership{sourcePlatform ? ` · ${sourcePlatform}` : ""}
              </span>
              {verify?.verified ? (
                <span className="flex items-center gap-1 font-label-caps text-label-caps text-secondary">
                  <span className="material-symbols-outlined text-[16px]">verified</span>Verified
                </span>
              ) : (
                <button onClick={doVerify} disabled={verifying} className="btn-outline px-4 py-1.5 text-body-sm">
                  {verifying ? "Checking…" : "Verify ownership"}
                </button>
              )}
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              {verify
                ? verify.reason
                : "Prove you own this source to earn a “Verified ✓” badge. GitHub verifies instantly from your login; X / Substack / Medium use a one-time code in your bio."}
            </p>
            {verify && !verify.verified && verify.code && (
              <div className="mt-3 rounded-md bg-surface-container p-3">
                <div className="mb-1 font-label-caps text-label-caps text-outline">Add this to your bio, then re-check</div>
                <code className="select-all font-data-mono text-[13px] text-primary">{verify.code}</code>
                {verify.instructions && (
                  <p className="mt-1 font-body-sm text-[12px] text-on-surface-variant">{verify.instructions}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Editor */}
      <div className="card">
        <h2 className="mb-4 font-headline-sm text-headline-sm">New content</h2>
        <div className="flex flex-col gap-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="rounded-lg border border-outline px-3 py-2 text-body-md" />
          <div className="flex flex-wrap gap-3">
            <select value={contentType} onChange={(e) => setContentType(e.target.value as "article" | "agent-skills" | "x-post")} className="rounded-lg border border-outline px-3 py-2 text-body-sm">
              <option value="article">Article (per-paragraph)</option>
              <option value="agent-skills">Agent Skills (per-block)</option>
              <option value="x-post">X Post</option>
            </select>
            <div className="flex items-center gap-2">
              <input value={price} onChange={(e) => setPrice(e.target.value)} className="w-28 rounded-lg border border-outline px-3 py-2 font-data-mono text-body-sm" />
              <span className="font-body-sm text-on-surface-variant">
                USDC per {contentType === "agent-skills" ? "skill block" : "paragraph"}
              </span>
            </div>
          </div>
          <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Summary (shown on the For You card + as the free intro)" className="rounded-lg border border-outline px-3 py-2 text-body-sm" />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma, separated" className="rounded-lg border border-outline px-3 py-2 text-body-sm" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} placeholder="Write or paste your content (markdown supported)…" className="rounded-lg border border-outline px-3 py-2 font-data-mono text-[13px]" />
        </div>

        {/* Commission split preview */}
        {preview?.split && (
          <div className="mt-4 rounded-lg bg-surface-container-low p-4 font-data-mono text-[13px]">
            <div className="mb-2 font-label-caps text-label-caps text-on-surface-variant">Commission split</div>
            <div>Reader pays:&nbsp;&nbsp;&nbsp;&nbsp;{preview.split.readerPays} USDC per block</div>
            <div>You receive:&nbsp;&nbsp;&nbsp;&nbsp;{preview.split.creator.amount} ({preview.split.creator.pct}%)</div>
            <div>Referrer:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{preview.split.referrer.amount} ({preview.split.referrer.pct}%) ← only if referred</div>
            <div>Platform:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{preview.split.platform.amount} ({preview.split.platform.pct}%)</div>
            <div className="mt-2 text-on-surface-variant">{preview.payableBlocks} payable block(s)</div>
          </div>
        )}

        {/* Agent-skills block 0 helper */}
        {contentType === "agent-skills" && preview?.block0Template && (
          <details className="mt-4">
            <summary className="cursor-pointer font-label-lg text-primary">Auto-generated free block 0 (agents see this) — you don&apos;t write it</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-[#0b0c10] p-4 font-data-mono text-[11px] text-[#e4e2dd]">{preview.block0Template}</pre>
            <p className="mt-1 font-body-sm text-on-surface-variant">
              How agents use this: they GET the agent endpoint, read this free block, pay per block via Circle Gateway, and retry with an <code>X-Payment-Token</code> header.
            </p>
          </details>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => setShowChunks((s) => !s)} disabled={!preview} className="btn-outline px-5 py-2">Preview Chunks</button>
          <button onClick={() => publish("draft")} disabled={busy || disabled || !title || !body} className="btn-outline px-5 py-2">Save Draft</button>
          <button onClick={() => publish("published")} disabled={busy || disabled || !title || !body} className="btn-primary px-6 py-2">Publish to Feed</button>
        </div>

        {/* Wallet gate: publish was saved as a draft because there's no payout wallet. */}
        {walletGatedDraft && (
          <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="mb-1 flex items-center gap-2 font-label-lg text-primary">
              <span className="material-symbols-outlined text-[18px]">account_balance_wallet</span>
              Saved to drafts — a wallet is needed to publish
            </div>
            <p className="mb-3 font-body-sm text-on-surface-variant">
              You get paid in USDC when readers unlock your work, so publishing needs a payout wallet.
              {embedded.status?.isAdmin
                ? " Connect an external wallet from the account menu, then hit Publish on the draft below."
                : " Create your free embedded wallet and we'll publish this draft right after."}
            </p>
            {!embedded.status?.isAdmin && (
              <button onClick={createWalletAndPublish} disabled={busy} className="btn-primary px-5 py-2">
                {busy ? "Setting up…" : "Create wallet & publish"}
              </button>
            )}
          </div>
        )}

        {showChunks && preview && (
          <div className="mt-4 flex flex-col gap-2">
            {preview.blocks.map((b) => (
              <div key={b.index} className="rounded-lg border border-outline-variant p-3 text-body-sm">
                <span className="font-label-caps text-label-caps text-outline">Block {b.index} · {b.length} chars</span>
                <p className="mt-1 text-on-surface-variant">{b.preview}…</p>
              </div>
            ))}
          </div>
        )}

        {published && (
          <div className="mt-4 rounded-lg border border-secondary/30 bg-secondary/5 p-4">
            <div className="mb-2 flex items-center gap-2 font-label-lg text-secondary"><span className="material-symbols-outlined text-[18px]">check_circle</span>Published! It&apos;s live in the For You feed. Share your links:</div>
            <UrlRow label="Reader URL" url={published.readerUrl} />
            {published.agentUrl && <UrlRow label="Agent endpoint" url={published.agentUrl} />}
            <Link href="/for-you" className="mt-2 inline-block font-label-lg text-label-lg text-primary hover:underline">
              View in For You →
            </Link>
          </div>
        )}
      </div>

      {/* Content table */}
      <div className="card">
        <h2 className="mb-4 font-headline-sm text-headline-sm">Your content</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-sm">
            <thead className="font-label-caps text-label-caps text-on-surface-variant">
              <tr className="border-b border-outline"><th className="py-2">Title</th><th>Type</th><th>Price</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-b border-outline-variant">
                  <td className="py-2"><a href={`/read/${c.slug}`} className="text-primary">{c.title}</a></td>
                  <td><span className="pill">{c.content_type}</span></td>
                  <td>{c.price_per_block} USDC</td>
                  <td>{c.status}</td>
                  <td className="flex gap-1 py-2">
                    <button disabled={disabled} onClick={() => toggle(c.id, c.status)} className="btn-outline px-2 py-1 text-[11px]">{c.status === "published" ? "Unpublish" : "Publish"}</button>
                    <button disabled={disabled} onClick={() => remove(c.id)} className="btn-outline px-2 py-1 text-[11px] text-red-600">Delete</button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={5} className="py-4 text-on-surface-variant">No content yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function UrlRow({ label, url }: { label: string; url: string }) {
  const toast = useToast();
  async function onCopy() {
    try {
      // Resolve to an absolute URL so the copied link works when pasted elsewhere.
      const abs = url.startsWith("http") ? url : `${window.location.origin}${url}`;
      await navigator.clipboard.writeText(abs);
      toast("success", "Link copied to clipboard");
    } catch {
      toast("error", "Couldn't copy — select and copy the link manually.");
    }
  }
  return (
    <div className="mb-1 flex items-center gap-2">
      <span className="w-28 font-label-caps text-label-caps text-on-surface-variant">{label}</span>
      <code className="flex-grow overflow-x-auto rounded bg-surface px-2 py-1 font-data-mono text-[12px]">{url}</code>
      <button onClick={onCopy} className="btn-outline px-2 py-1 text-[11px]">Copy</button>
    </div>
  );
}
