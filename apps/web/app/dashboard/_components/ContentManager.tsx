"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toaster";
import { useEmbeddedWallet } from "@/lib/useEmbeddedWallet";
import { autoChunkArticle } from "@/lib/chunk-content";
import { normalizeImageUrl, MAX_SKIMFLOW_IMAGES, MAX_CAPTION_CHARS } from "@/lib/image-links";
import { formatUsdc } from "@/lib/money";

interface ContentRow {
  id: string;
  title: string;
  slug: string;
  content_type: string;
  price_per_block: string;
  status: string;
}
interface PreviewBlock {
  index: number;
  preview: string;
  length: number;
  lines?: number;
  words?: number;
  errors?: string[];
  warnings?: string[];
}
interface Preview {
  payableBlocks: number;
  blocks: PreviewBlock[];
  hasErrors?: boolean;
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
  const [contentType, setContentType] = useState<"article" | "agent-skills" | "picture">("article");
  const [body, setBody] = useState("");
  const [importSource, setImportSource] = useState<"medium" | "github">("medium");
  // Picture Skim-Flow image links (in order; index 0 is the free preview image).
  const [images, setImages] = useState<{ url: string; caption: string }[]>([]);
  const [imgUrl, setImgUrl] = useState("");
  const [imgCaption, setImgCaption] = useState("");
  const [imgChecking, setImgChecking] = useState(false);
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState("");
  const [price, setPrice] = useState("0.05");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [showChunks, setShowChunks] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<{ readerUrl: string; agentUrl?: string } | null>(null);

  // Import provenance (recorded for attribution; no ownership-verification gate).
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourcePlatform, setSourcePlatform] = useState<string | null>(null);
  // An imported Agent Skill whose .md had no description — publish is blocked
  // until the creator fills the summary (§1d: no silently-incomplete skills).
  const [needsMeta, setNeedsMeta] = useState(false);

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
        setContentType(d.contentType === "agent-skills" || d.format === "markdown" ? "agent-skills" : "article");
        if (typeof d.summary === "string") setSummary(d.summary);
        if (typeof d.tags === "string" && d.tags) setTags(d.tags);
        setSourceUrl(d.sourceUrl ?? importUrl);
        setSourcePlatform(d.sourcePlatform ?? null);
        setNeedsMeta(!!d.needsMetadata);
        if (d.needsMetadata) {
          toast("warning", "Imported — add a description before publishing this Agent Skill (the file had none).");
        } else {
          toast("success", "Imported — review and publish when ready.");
        }
      } else {
        toast("error", d.message ?? d.error ?? "Import failed");
      }
    } finally {
      setBusy(false);
    }
  }

  /** Add a Skim-Flow image: normalize the link, then confirm it actually loads
   *  as an image before accepting it (the load IS the validity check, §5a). */
  function addImage() {
    const raw = imgUrl.trim();
    if (!raw) return;
    if (images.length >= MAX_SKIMFLOW_IMAGES) {
      toast("warning", `Maximum ${MAX_SKIMFLOW_IMAGES} images per post.`);
      return;
    }
    const url = normalizeImageUrl(raw);
    setImgChecking(true);
    const probe = new Image();
    probe.onload = () => {
      setImages((prev) => [...prev, { url, caption: imgCaption.trim().slice(0, MAX_CAPTION_CHARS) }]);
      setImgUrl("");
      setImgCaption("");
      setImgChecking(false);
    };
    probe.onerror = () => {
      setImgChecking(false);
      toast("error", "This link isn't publicly viewable as an image — check sharing settings or use a direct image URL.");
    };
    probe.src = url;
  }

  function removeImage(i: number) {
    setImages((prev) => prev.filter((_, idx) => idx !== i));
  }

  /** Regroup the body into chunks that satisfy the 6-line / 400-word limits. */
  function applyAutoChunk() {
    if (!body.trim()) return;
    setBody(autoChunkArticle(body));
    toast("info", "Re-grouped into chunks that meet the limits — review the preview below.");
  }

  async function publish(status: "draft" | "published") {
    setBusy(true);
    setPublished(null);
    try {
      const r = await fetch("/api/creator/content", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          contentType,
          body: contentType === "picture" ? "" : body,
          images: contentType === "picture" ? images : undefined,
          pricePerBlock: price,
          summary,
          tags,
          status,
          sourceUrl,
        }),
      });
      const d = await r.json();
      if (r.ok && d.walletRequired) {
        // Publish was downgraded to a draft because there's no payout wallet.
        // Keep the editor cleared (the draft is saved) and prompt wallet setup.
        setWalletGatedDraft(d.contentId ?? null);
        setTitle(""); setBody(""); setSummary(""); setTags(""); setPreview(null);
        setSourceUrl(null); setSourcePlatform(null); setNeedsMeta(false); setImages([]);
        loadList();
        toast("info", d.message ?? "Saved to drafts — create a wallet to publish.");
      } else if (r.ok) {
        if (status === "published") setPublished({ readerUrl: d.readerUrl, agentUrl: d.agentUrl });
        setTitle(""); setBody(""); setSummary(""); setTags(""); setPreview(null);
        setSourceUrl(null); setSourcePlatform(null); setNeedsMeta(false); setImages([]);
        loadList();
        toast(
          "success",
          status === "published" ? "Published — it's live in the For You feed now." : "Draft saved."
        );
      } else if (d.error === "chunk_validation") {
        // Surface the first couple of specific chunk problems so the creator
        // knows exactly what to fix (or can hit Auto-chunk).
        const msgs: string[] = (d.chunks ?? []).flatMap((c: { errors?: string[] }) => c.errors ?? []);
        toast("error", msgs.slice(0, 3).join(" ") || d.message || "Some chunks don't meet the limits.");
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
    let r = await fetch(`/api/creator/content/${id}`, { method: "DELETE", credentials: "include" });
    if (r.status === 409) {
      const d = await r.json().catch(() => ({}));
      if (!confirm(`${d.paid} reader(s) have already paid for this. Removing paid content is recorded for review. Remove anyway?`)) return;
      r = await fetch(`/api/creator/content/${id}?confirm=1`, { method: "DELETE", credentials: "include" });
    }
    if (r.status === 403) {
      const d = await r.json().catch(() => ({}));
      toast("error", d.message ?? "This content can only be removed by an admin.");
      return;
    }
    if (!r.ok) {
      toast("error", "Couldn't delete that.");
      return;
    }
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
  // Content present enough to save/publish: images for picture, body otherwise.
  const hasContent = contentType === "picture" ? images.length > 0 : !!body.trim();

  return (
    <div className="flex flex-col gap-6">
      {/* Import — exactly two sources: Medium articles, or GitHub .md skills. */}
      <div className="card">
        <h2 className="mb-3 font-headline-sm text-headline-sm">Import</h2>
        <div className="mb-3 flex gap-2">
          <button
            onClick={() => setImportSource("medium")}
            aria-pressed={importSource === "medium"}
            className={`rounded-full px-4 py-1.5 font-label-caps text-label-caps transition-colors ${importSource === "medium" ? "bg-primary text-on-primary" : "border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"}`}
          >
            From Medium
          </button>
          <button
            onClick={() => setImportSource("github")}
            aria-pressed={importSource === "github"}
            className={`rounded-full px-4 py-1.5 font-label-caps text-label-caps transition-colors ${importSource === "github" ? "bg-primary text-on-primary" : "border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"}`}
          >
            From GitHub (Agent Skill)
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder={importSource === "medium" ? "https://medium.com/…/your-article" : "https://github.com/…/skill.md (or raw .md URL)"}
            className="flex-grow rounded-lg border border-outline px-3 py-2 text-body-sm"
          />
          <button onClick={doImport} disabled={busy || disabled} className="btn-primary px-5 py-2">Import &amp; Monetize</button>
        </div>
        <p className="mt-2 font-body-sm text-[12px] text-on-surface-variant">
          Want to share an X post? Copy and paste the text into the editor below — it publishes as a single chunk.
        </p>

        {/* Import provenance (informational — publishing is never gated). */}
        {sourceUrl && (
          <div className="mt-4 rounded-lg bg-surface-container-low/60 p-3">
            <span className="font-label-caps text-label-caps text-on-surface-variant">
              Imported source{sourcePlatform ? ` · ${sourcePlatform}` : ""}
            </span>
            <p className="mt-1 truncate font-body-sm text-[12px] text-outline">{sourceUrl}</p>
          </div>
        )}
      </div>

      {/* Editor */}
      <div className="card">
        <h2 className="mb-4 font-headline-sm text-headline-sm">New content</h2>
        <div className="flex flex-col gap-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="rounded-lg border border-outline px-3 py-2 text-body-md" />
          <div className="flex flex-wrap gap-3">
            <select value={contentType} onChange={(e) => setContentType(e.target.value as "article" | "agent-skills" | "picture")} className="rounded-lg border border-outline px-3 py-2 text-body-sm">
              <option value="article">Article (chunked)</option>
              <option value="picture">Picture Skim-Flow (per-image)</option>
              <option value="agent-skills">Agent Skills (per-block)</option>
            </select>
            <div className="flex items-center gap-2">
              <input value={price} onChange={(e) => setPrice(e.target.value)} className="w-28 rounded-lg border border-outline px-3 py-2 font-data-mono text-body-sm" />
              <span className="font-body-sm text-on-surface-variant">
                USDC per {contentType === "agent-skills" ? "skill block" : contentType === "picture" ? "image" : "chunk"}
              </span>
            </div>
          </div>
          {contentType === "article" && (
            <p className="font-body-sm text-[12px] text-on-surface-variant">
              Leave a blank line between sections to start a new chunk. Every chunk needs at least 6 lines and at most 400
              words, and must end on a complete sentence (the last chunk is exempt from the line minimum). Or hit{" "}
              <strong>Auto-chunk</strong> to group it for you.
            </p>
          )}
          <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Summary (shown on the For You card + as the free intro)" className="rounded-lg border border-outline px-3 py-2 text-body-sm" />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma, separated" className="rounded-lg border border-outline px-3 py-2 text-body-sm" />
          {contentType === "picture" ? (
            <PictureEditor
              images={images}
              imgUrl={imgUrl}
              imgCaption={imgCaption}
              imgChecking={imgChecking}
              onUrl={setImgUrl}
              onCaption={setImgCaption}
              onAdd={addImage}
              onRemove={removeImage}
            />
          ) : (
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} placeholder="Write or paste your content (markdown supported)…" className="rounded-lg border border-outline px-3 py-2 font-data-mono text-[13px]" />
          )}
        </div>

        {/* Commission split preview */}
        {preview?.split && (
          <div className="mt-4 rounded-lg bg-surface-container-low p-4 font-data-mono text-[13px]">
            <div className="mb-2 font-label-caps text-label-caps text-on-surface-variant">Commission split</div>
            <div>Reader pays:&nbsp;&nbsp;&nbsp;&nbsp;{formatUsdc(preview.split.readerPays)} USDC per block</div>
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

        {/* Publish is blocked while any chunk violates the limits (article only). */}
        {contentType === "article" && preview?.hasErrors && (
          <div className="mt-4 rounded-lg border border-error/40 bg-error/5 p-3 font-body-sm text-[13px] text-error">
            Some chunks don&apos;t meet the limits — fix the flagged chunks below or hit <strong>Auto-chunk</strong> before publishing.
          </div>
        )}

        {/* §1d: imported skill had no description — require one before publishing. */}
        {needsMeta && !summary.trim() && (
          <div className="mt-4 rounded-lg border border-primary/40 bg-primary/5 p-3 font-body-sm text-[13px] text-on-surface">
            This skill&apos;s file had no description. Add a <strong>Summary</strong> above before publishing.
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {contentType === "article" && (
            <button onClick={applyAutoChunk} disabled={!body.trim() || disabled} className="btn-outline px-5 py-2">Auto-chunk</button>
          )}
          {contentType !== "picture" && (
            <button onClick={() => setShowChunks((s) => !s)} disabled={!preview} className="btn-outline px-5 py-2">Preview Chunks</button>
          )}
          <button onClick={() => publish("draft")} disabled={busy || disabled || !title || !hasContent} className="btn-outline px-5 py-2">Save Draft</button>
          <button
            onClick={() => publish("published")}
            disabled={
              busy || disabled || !title || !hasContent ||
              (contentType === "article" && !!preview?.hasErrors) ||
              (needsMeta && !summary.trim())
            }
            className="btn-primary px-6 py-2"
          >
            Publish to Feed
          </button>
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
            {preview.blocks.map((b) => {
              const hasErr = (b.errors?.length ?? 0) > 0;
              return (
                <div
                  key={b.index}
                  className={`rounded-lg border p-3 text-body-sm ${hasErr ? "border-error/50 bg-error/5" : "border-outline-variant"}`}
                >
                  <span className="font-label-caps text-label-caps text-outline">
                    Block {b.index}
                    {typeof b.lines === "number" ? ` · ${b.lines} lines` : ""}
                    {typeof b.words === "number" ? ` · ${b.words} words` : ` · ${b.length} chars`}
                  </span>
                  <p className="mt-1 text-on-surface-variant">{b.preview}…</p>
                  {b.errors?.map((e, i) => (
                    <p key={`e${i}`} className="mt-1 font-body-sm text-[12px] text-error">⚠ {e}</p>
                  ))}
                  {b.warnings?.map((w, i) => (
                    <p key={`w${i}`} className="mt-1 font-body-sm text-[12px] text-on-surface-variant">ℹ {w}</p>
                  ))}
                </div>
              );
            })}
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
                  <td>{formatUsdc(c.price_per_block)} USDC</td>
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

/** Skim-Flow image-link editor: paste a link (validated on add), optional
 *  caption, ordered list with remove. Image 0 is the free preview. */
function PictureEditor({
  images,
  imgUrl,
  imgCaption,
  imgChecking,
  onUrl,
  onCaption,
  onAdd,
  onRemove,
}: {
  images: { url: string; caption: string }[];
  imgUrl: string;
  imgCaption: string;
  imgChecking: boolean;
  onUrl: (v: string) => void;
  onCaption: (v: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-body-sm text-[12px] text-on-surface-variant">
        Paste an image link (Google Drive share links work, or any public image URL). Each image is a separate paid
        unlock; the first image is a free preview. Up to {MAX_SKIMFLOW_IMAGES} images.
      </p>

      <div className="flex flex-wrap items-start gap-2">
        <input
          value={imgUrl}
          onChange={(e) => onUrl(e.target.value)}
          placeholder="https://drive.google.com/file/d/…/view  or  https://…/image.jpg"
          className="min-w-[16rem] flex-grow rounded-lg border border-outline px-3 py-2 text-body-sm"
        />
        <input
          value={imgCaption}
          onChange={(e) => onCaption(e.target.value.slice(0, MAX_CAPTION_CHARS))}
          placeholder="Caption (optional)"
          className="w-48 rounded-lg border border-outline px-3 py-2 text-body-sm"
        />
        <button onClick={onAdd} disabled={imgChecking || images.length >= MAX_SKIMFLOW_IMAGES} className="btn-outline px-4 py-2">
          {imgChecking ? "Checking…" : "Add image"}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <span className="font-label-caps text-label-caps text-outline">
          {images.length} / {MAX_SKIMFLOW_IMAGES} images
        </span>
      </div>

      {images.length > 0 && (
        <div className="flex flex-col gap-2">
          {images.map((im, i) => (
            <div key={`${im.url}-${i}`} className="flex items-center gap-3 rounded-lg border border-outline-variant p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.url} alt="" className="h-14 w-14 flex-shrink-0 rounded object-cover" />
              <div className="min-w-0 flex-grow">
                <div className="font-label-caps text-label-caps text-outline">
                  {i === 0 ? "Free preview" : `Image ${i}`}
                </div>
                <div className="truncate font-body-sm text-[12px] text-on-surface-variant">{im.caption || im.url}</div>
              </div>
              <button onClick={() => onRemove(i)} className="btn-outline px-2 py-1 text-[11px] text-red-600">Remove</button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 font-body-sm text-[12px] text-on-surface-variant">
        Images are linked, not uploaded — if you remove or unshare the original file later, readers who paid won&apos;t be
        able to see it.
      </div>
    </div>
  );
}
