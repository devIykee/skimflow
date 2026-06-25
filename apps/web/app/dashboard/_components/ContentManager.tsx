"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toaster";
import { useEmbeddedWallet } from "@/lib/useEmbeddedWallet";
import { autoChunkArticle } from "@/lib/chunk-content";
import { normalizeImageUrl, MAX_SKIMFLOW_IMAGES, MAX_CAPTION_CHARS } from "@/lib/image-links";
import { formatUsdc } from "@/lib/money";
import { queueRequest } from "@/lib/offline-drafts";

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

/** Shared input styling so every field matches the app's surfaces + focus ring. */
const inputClass =
  "w-full rounded-lg border border-outline-variant bg-surface-container-low px-3.5 py-2.5 text-body-md text-on-surface placeholder:text-outline transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

const CONTENT_TYPES = [
  { value: "article", label: "Article", icon: "article", unit: "chunk" },
  { value: "picture", label: "Picture", icon: "image", unit: "image" },
  { value: "agent-skills", label: "Agent Skill", icon: "smart_toy", unit: "skill block" },
] as const;

/** Labelled field wrapper: caps label, the control, and an optional hint line. */
function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-label-caps text-label-caps text-on-surface-variant">{label}</label>
      {children}
      {hint && <p className="font-body-sm text-[12px] text-outline">{hint}</p>}
    </div>
  );
}

/** One figure in the commission-split preview grid. */
function SplitCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="font-label-caps text-[10px] uppercase text-outline">{label}</div>
      <div className={`font-data-mono text-[14px] ${highlight ? "font-semibold text-primary" : "text-on-surface"}`}>{value}</div>
    </div>
  );
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
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<{ readerUrl: string; agentUrl?: string } | null>(null);
  // When set, the editor is updating an existing piece (PATCH) rather than
  // creating a new one (POST). Its content_type is locked while editing.
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadList = useCallback(() => {
    fetch("/api/creator/content", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setList(d.content ?? []))
      .catch(() => {});
  }, []);
  useEffect(loadList, [loadList]);

  // Deep-link from a reader's "Edit in dashboard" link (/dashboard?edit=<id>):
  // auto-open that piece in the editor, then strip the param so a refresh won't
  // re-trigger it. Runs once on mount.
  const editParamHandled = useRef(false);
  useEffect(() => {
    if (editParamHandled.current || typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("edit");
    if (!id) return;
    editParamHandled.current = true;
    void startEdit(id);
    window.history.replaceState(null, "", window.location.pathname);
    // startEdit is a stable function declaration; run only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      toast("error", "This link isn't publicly viewable as an image. Check sharing settings or use a direct image URL.");
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
    toast("info", "Re-grouped into chunks that meet the limits. Review the preview below.");
  }

  function resetEditor() {
    setTitle(""); setBody(""); setSummary(""); setTags(""); setPreview(null);
    setImages([]);
    setEditingId(null);
  }

  /** Load one of the creator's pieces into the editor to update it. */
  async function startEdit(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/creator/content/${id}`, { credentials: "include" });
      const d = await r.json();
      if (!r.ok) {
        toast("error", d.message ?? d.error ?? "Couldn't load that piece.");
        return;
      }
      const c = d.content;
      setEditingId(c.id);
      setTitle(c.title ?? "");
      setSummary(c.summary ?? "");
      setTags(c.tags ?? "");
      setPrice(String(c.price_per_block ?? "0.05"));
      setContentType((c.content_type as "article" | "agent-skills" | "picture") ?? "article");
      setBody(c.content_type === "picture" ? "" : (c.body ?? ""));
      setImages(c.content_type === "picture" ? (d.images ?? []) : []);
      setPublished(null);
      toast("info", "Loaded into the editor below. Make your changes, then Update.");
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  }

  async function publish(status: "draft" | "published") {
    // Offline + saving a draft → queue it for Background Sync instead of failing.
    // (Publishing offline isn't supported — it needs the live feed/settlement.)
    if (status === "draft" && typeof navigator !== "undefined" && !navigator.onLine) {
      try {
        const url = editingId ? `/api/creator/content/${editingId}` : "/api/creator/content";
        const method = editingId ? "PATCH" : "POST";
        const reqBody = editingId
          ? { title, body: contentType === "picture" ? undefined : body, pricePerBlock: price, summary, tags, status: "draft" }
          : { title, contentType, body: contentType === "picture" ? "" : body, images: contentType === "picture" ? images : undefined, pricePerBlock: price, summary, tags, status: "draft" };
        await queueRequest({ url, method, body: JSON.stringify(reqBody), label: title || "Untitled draft" });
        toast("info", "You're offline — draft saved on this device and will sync automatically when you're back online.");
        resetEditor();
      } catch {
        toast("error", "Couldn't save the draft offline.");
      }
      return;
    }

    setBusy(true);
    setPublished(null);
    try {
      // Editing an existing piece → PATCH it (re-chunks when the body changed);
      // otherwise create a new one.
      if (editingId) {
        const r = await fetch(`/api/creator/content/${editingId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            body: contentType === "picture" ? undefined : body,
            pricePerBlock: price,
            summary,
            tags,
            status,
          }),
        });
        const d = await r.json();
        if (r.ok && d.ok) {
          resetEditor();
          loadList();
          toast("success", status === "published" ? "Updated and live." : "Changes saved.");
        } else if (d.needsConfirm) {
          if (confirm(`${d.paid} reader(s) have paid for this. Editing the text is recorded for review. Save anyway?`)) {
            const r2 = await fetch(`/api/creator/content/${editingId}?confirm=1`, {
              method: "PATCH",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title, body: contentType === "picture" ? undefined : body, pricePerBlock: price, summary, tags, status }),
            });
            if (r2.ok) { resetEditor(); loadList(); toast("success", "Changes saved."); }
            else { const d2 = await r2.json().catch(() => ({})); toast("error", d2.message ?? d2.error ?? "Update failed."); }
          }
        } else if (d.walletRequired) {
          toast("info", d.message ?? "Create a payout wallet before publishing.");
        } else {
          toast("error", d.message ?? d.error ?? "Update failed.");
        }
        return;
      }

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
        }),
      });
      const d = await r.json();
      if (r.ok && d.walletRequired) {
        // Publish was downgraded to a draft because there's no payout wallet.
        // Keep the editor cleared (the draft is saved) and prompt wallet setup.
        setWalletGatedDraft(d.contentId ?? null);
        setTitle(""); setBody(""); setSummary(""); setTags(""); setPreview(null);
        setImages([]);
        loadList();
        toast("info", d.message ?? "Saved to drafts. Create a wallet to publish.");
      } else if (r.ok) {
        if (status === "published") setPublished({ readerUrl: d.readerUrl, agentUrl: d.agentUrl });
        setTitle(""); setBody(""); setSummary(""); setTags(""); setPreview(null);
        setImages([]);
        loadList();
        toast(
          "success",
          status === "published" ? "Published. It's live in the For You feed now." : "Draft saved."
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
          toast("success", "Published. It's live in the For You feed now.");
        } else {
          const d = await r.json().catch(() => ({}));
          toast("error", d.message ?? d.error ?? "Wallet created, but publishing the draft failed. Try Publish from the table.");
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
    toast("success", next === "published" ? "Now live in the For You feed." : "Unpublished. Hidden from the For You feed.");
  }

  const disabled = impersonating;
  // Content present enough to save/publish: images for picture, body otherwise.
  const hasContent = contentType === "picture" ? images.length > 0 : !!body.trim();

  return (
    <div className="flex flex-col gap-6">
      {/* Editor */}
      <div className="card !p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-outline-variant px-5 py-4 md:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[20px]">{editingId ? "edit_document" : "post_add"}</span>
            </span>
            <div>
              <h2 className="font-headline-sm text-[15px] font-semibold leading-tight">{editingId ? "Edit content" : "New content"}</h2>
              <p className="font-body-sm text-[12px] text-on-surface-variant">
                {editingId ? "Update your piece and re-publish." : "Write or paste a piece, price it per block, and publish."}
              </p>
            </div>
          </div>
          {editingId && (
            <button onClick={resetEditor} disabled={busy} className="flex items-center gap-1 font-label-caps text-label-caps text-outline transition-colors hover:text-primary">
              <span className="material-symbols-outlined text-[16px]">close</span>
              Cancel
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-col gap-5 px-5 py-5 md:px-6">
          {/* Format + price */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <Field label="Format">
              <div className="inline-flex flex-wrap rounded-lg border border-outline-variant bg-surface-container-low p-1">
                {CONTENT_TYPES.map((t) => {
                  const active = contentType === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      disabled={!!editingId}
                      onClick={() => setContentType(t.value)}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-label-lg text-label-lg transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${active ? "bg-surface text-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}
                    >
                      <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Price">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    inputMode="decimal"
                    className={`${inputClass} w-32 pr-14 font-data-mono`}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-label-caps text-label-caps text-outline">USDC</span>
                </div>
                <span className="whitespace-nowrap font-body-sm text-[12px] text-on-surface-variant">
                  per {CONTENT_TYPES.find((t) => t.value === contentType)?.unit}
                </span>
              </div>
            </Field>
          </div>

          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A clear, compelling title" className={inputClass} />
          </Field>

          {contentType === "picture" ? (
            <Field label="Images">
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
            </Field>
          ) : (
            <Field
              label="Content"
              hint={
                contentType === "article" ? (
                  <>
                    Leave a blank line between sections to start a new chunk. Each chunk needs 6–400 words and must end on a
                    complete sentence (the last is exempt from the minimum). Or hit <strong>Auto-chunk</strong> to group it for you.
                  </>
                ) : (
                  "Markdown supported. Each block becomes a separately-unlockable unit."
                )
              }
            >
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                placeholder="Write or paste your content (markdown supported)…"
                className={`${inputClass} resize-y font-data-mono text-[13px] leading-relaxed`}
              />
            </Field>
          )}

          <div className="grid grid-cols-1 gap-4 border-t border-outline-variant pt-5 md:grid-cols-2">
            <Field label="Summary" hint="Shown on the For You card and as the free intro.">
              <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One or two sentences" className={inputClass} />
            </Field>
            <Field label="Tags" hint="Comma-separated, e.g. fiction, sci-fi, weekly.">
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma, separated" className={inputClass} />
            </Field>
          </div>
          {/* Commission split preview */}
          {preview?.split && (
            <div className="rounded-xl border border-outline-variant bg-surface-container-low p-4">
              <div className="mb-3 flex items-center gap-1.5 font-label-caps text-label-caps text-on-surface-variant">
                <span className="material-symbols-outlined text-[16px]">pie_chart</span>
                Commission split
                <span className="ml-auto font-body-sm text-[11px] normal-case text-outline">{preview.payableBlocks} payable block(s)</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <SplitCell label="Reader pays" value={`${formatUsdc(preview.split.readerPays)} USDC`} />
                <SplitCell label={`You · ${preview.split.creator.pct}%`} value={`${preview.split.creator.amount} USDC`} highlight />
                <SplitCell label={`Referrer · ${preview.split.referrer.pct}%`} value={`${preview.split.referrer.amount} USDC`} />
                <SplitCell label={`Platform · ${preview.split.platform.pct}%`} value={`${preview.split.platform.amount} USDC`} />
              </div>
            </div>
          )}

          {/* Agent-skills block 0 helper */}
          {contentType === "agent-skills" && preview?.block0Template && (
            <details className="rounded-xl border border-outline-variant p-3">
              <summary className="cursor-pointer font-label-lg text-label-lg text-primary">Auto-generated free block 0 (agents see this) — you don&apos;t write it</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-[#0b0c10] p-4 font-data-mono text-[11px] text-[#e4e2dd]">{preview.block0Template}</pre>
              <p className="mt-1 font-body-sm text-[12px] text-on-surface-variant">
                Agents GET the endpoint, read this free block, pay per block via Circle Gateway, and retry with an <code>X-Payment-Token</code> header.
              </p>
            </details>
          )}

          {/* Publish blocked while a chunk violates the limits (article only). */}
          {contentType === "article" && preview?.hasErrors && (
            <div className="flex items-start gap-2 rounded-xl border border-error/40 bg-error/5 p-3 font-body-sm text-[13px] text-error">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <span>Some chunks don&apos;t meet the limits. Fix the flagged chunks below or hit <strong>Auto-chunk</strong> before publishing.</span>
            </div>
          )}
        </div>

        {/* Action footer */}
        <div className="flex flex-col-reverse gap-3 border-t border-outline-variant bg-surface-container-low/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <div className="flex flex-wrap gap-2">
            {contentType === "article" && (
              <button onClick={applyAutoChunk} disabled={!body.trim() || disabled} className="btn-outline px-4 py-2 disabled:opacity-50">Auto-chunk</button>
            )}
            {contentType !== "picture" && (
              <button onClick={() => setShowChunks((s) => !s)} disabled={!preview} className="btn-outline px-4 py-2 disabled:opacity-50">{showChunks ? "Hide chunks" : "Preview chunks"}</button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => publish("draft")} disabled={busy || disabled || !title || !hasContent} className="btn-outline px-5 py-2 disabled:opacity-50">{editingId ? "Save as draft" : "Save draft"}</button>
            <button
              onClick={() => publish("published")}
              disabled={busy || disabled || !title || !hasContent || (contentType === "article" && !!preview?.hasErrors)}
              className="btn-primary flex items-center gap-1.5 px-6 py-2 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">{editingId ? "save" : "rocket_launch"}</span>
              {editingId ? "Update" : "Publish to feed"}
            </button>
          </div>
        </div>

        {(walletGatedDraft || (showChunks && preview) || published) && (
          <div className="flex flex-col gap-4 border-t border-outline-variant px-5 py-5 md:px-6">
            {/* Wallet gate: publish was saved as a draft because there's no payout wallet. */}
            {walletGatedDraft && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                <div className="mb-1 flex items-center gap-2 font-label-lg text-primary">
                  <span className="material-symbols-outlined text-[18px]">account_balance_wallet</span>
                  Saved to drafts. A wallet is needed to publish
                </div>
                <p className="mb-3 font-body-sm text-on-surface-variant">
                  You get paid in USDC when readers unlock your work, so publishing needs a payout wallet.
                  {embedded.status?.isAdmin
                    ? " Connect an external wallet from the account menu, then hit Publish on the draft below."
                    : " Your Skimflow wallet is created automatically — we'll publish this draft as soon as it's ready."}
                </p>
                {!embedded.status?.isAdmin && (
                  <button onClick={createWalletAndPublish} disabled={busy} className="btn-primary px-5 py-2">
                    {busy ? "Setting up…" : "Finish setup & publish"}
                  </button>
                )}
              </div>
            )}

            {showChunks && preview && (
              <div className="flex flex-col gap-2">
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
              <div className="rounded-xl border border-secondary/30 bg-secondary/5 p-4">
                <div className="mb-2 flex items-center gap-2 font-label-lg text-secondary"><span className="material-symbols-outlined text-[18px]">check_circle</span>Published! It&apos;s live in the For You feed. Share your links:</div>
                <UrlRow label="Reader URL" url={published.readerUrl} />
                {published.agentUrl && <UrlRow label="Agent endpoint" url={published.agentUrl} />}
                <Link href="/for-you" className="mt-2 inline-block font-label-lg text-label-lg text-primary hover:underline">
                  View in For You →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content table */}
      <div className="card !p-0 overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-outline-variant px-5 py-4 md:px-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/10 text-secondary">
            <span className="material-symbols-outlined text-[20px]">library_books</span>
          </span>
          <h2 className="font-headline-sm text-[15px] font-semibold">Your content</h2>
          {list.length > 0 && (
            <span className="ml-auto rounded-full bg-surface-container-high px-2.5 py-0.5 font-label-caps text-label-caps text-on-surface-variant">
              {list.length}
            </span>
          )}
        </div>

        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
            <span className="material-symbols-outlined text-[28px] text-outline">draft</span>
            <p className="font-body-md text-on-surface-variant">Nothing published yet.</p>
            <p className="font-body-sm text-[12px] text-outline">Create your first piece above to see it here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="border-b border-outline-variant font-label-caps text-label-caps text-on-surface-variant">
                  <th className="px-5 py-2.5 md:px-6">Title</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Price</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-5 py-2.5 text-right md:px-6">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="border-b border-outline-variant/60 transition-colors last:border-0 hover:bg-surface-container-low/50">
                    <td className="px-5 py-3 md:px-6">
                      <a href={`/read/${c.slug}`} className="font-medium text-on-surface hover:text-primary hover:underline">{c.title}</a>
                    </td>
                    <td className="px-3 py-3"><span className="pill text-[10px]">{c.content_type}</span></td>
                    <td className="whitespace-nowrap px-3 py-3 font-data-mono text-[12px] text-on-surface-variant">{formatUsdc(c.price_per_block)} USDC</td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-label-caps text-[10px] uppercase ${c.status === "published" ? "bg-secondary/10 text-secondary" : "bg-on-surface/5 text-on-surface-variant"}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${c.status === "published" ? "bg-secondary" : "bg-outline"}`} />
                        {c.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 md:px-6">
                      <div className="flex justify-end gap-1">
                        {c.content_type === "book" ? (
                          <Link href={`/dashboard/create-book?edit=${c.id}`} className="btn-outline px-2.5 py-1 text-[11px]">Edit</Link>
                        ) : (
                          <button disabled={disabled || busy} onClick={() => startEdit(c.id)} className="btn-outline px-2.5 py-1 text-[11px] disabled:opacity-50">Edit</button>
                        )}
                        <button disabled={disabled} onClick={() => toggle(c.id, c.status)} className="btn-outline px-2.5 py-1 text-[11px] disabled:opacity-50">{c.status === "published" ? "Unpublish" : "Publish"}</button>
                        <button disabled={disabled} onClick={() => remove(c.id)} className="btn-outline px-2.5 py-1 text-[11px] text-red-600 disabled:opacity-50">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
      toast("error", "Couldn't copy. Select and copy the link manually.");
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
        Images are linked, not uploaded. If you remove or unshare the original file later, readers who paid won&apos;t be
        able to see it.
      </div>
    </div>
  );
}
