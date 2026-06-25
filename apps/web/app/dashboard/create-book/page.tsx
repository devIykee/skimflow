"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toaster";
import { splitPages } from "@/lib/chunk-content";
import { normalizeImageUrl, isLikelyImageUrl } from "@/lib/image-links";

interface ChapterDraft {
  title: string;
  body: string;
}

/**
 * Local-only autosave snapshot. This is a same-device crash/exit safety net —
 * NOT synced to the backend. "Save draft" / "Publish book" are the deliberate,
 * cross-device persistence actions; a successful one clears this snapshot.
 */
interface BookDraftSnapshot {
  v: number;
  title: string;
  coverImageUrl: string;
  description: string;
  price: string;
  chapters: ChapterDraft[];
  savedAt: number;
}
const AUTOSAVE_KEY = "skimflow:create-book:autosave";
const AUTOSAVE_VERSION = 1;

/** Shared input styling — matches the dashboard ContentManager fields. */
const inputClass =
  "w-full rounded-lg border border-outline-variant bg-surface-container-low px-3.5 py-2.5 text-body-md text-on-surface placeholder:text-outline transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
const labelClass = "mb-1.5 block font-label-caps text-label-caps text-on-surface-variant";

/** Only treat a snapshot as worth keeping/restoring if it has real content. */
function snapshotHasContent(s: { title: string; description: string; chapters: ChapterDraft[] }) {
  return Boolean(s.title.trim() || s.description.trim() || s.chapters.some((c) => c.body.trim()));
}

/**
 * Chapter Builder — create a Skimflow Book. The author sets a cover + blurb, then
 * adds chapters one at a time (paste text; split pages with a `---` line). Pages
 * are the payable unit; the very first page is a free preview. Publishes in one
 * POST to /api/creator/content with contentType:"book".
 */
export default function CreateBookPage() {
  const router = useRouter();
  const toast = useToast();

  const [title, setTitle] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("0.05");
  const [chapters, setChapters] = useState<ChapterDraft[]>([{ title: "Chapter 1", body: "" }]);
  const [busy, setBusy] = useState(false);
  // When set, we're editing an existing book (PATCH) rather than creating one.
  const [editingId, setEditingId] = useState<string | null>(null);

  // Autosave plumbing. `restorable` holds a found-on-load snapshot awaiting the
  // user's restore/discard decision; `ready` gates the autosave writer so it
  // never overwrites that snapshot before the user chooses.
  const [restorable, setRestorable] = useState<BookDraftSnapshot | null>(null);
  const [ready, setReady] = useState(false);

  // Words per page (split on `---`) for the live writing counter, plus the
  // page count and chapter word totals derived from it.
  const pageWords = useMemo(
    () => chapters.map((ch) => splitPages(ch.body).map((p) => (p.trim().match(/\S+/g) ?? []).length)),
    [chapters]
  );
  const pageCounts = pageWords.map((w) => w.length);
  const totalPages = pageCounts.reduce((a, b) => a + b, 0);
  // Global page offset for each chapter (page 1 of the whole book is the free
  // preview), so per-page labels show the book-wide page number.
  const chapterPageOffset = pageCounts.reduce<number[]>((acc, n, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + pageCounts[i - 1]);
    return acc;
  }, []);

  function clearAutosave() {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
  }

  // On load: if editing an existing book (?edit=<id>), fetch and populate it and
  // skip the new-book autosave entirely. Otherwise surface any local autosave.
  useEffect(() => {
    const editId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("edit") : null;
    if (editId) {
      (async () => {
        try {
          const r = await fetch(`/api/creator/content/${editId}`, { credentials: "include" });
          const d = await r.json();
          if (r.ok && d.content?.content_type === "book") {
            setEditingId(editId);
            setTitle(d.content.title ?? "");
            setCoverImageUrl(d.content.cover_image_url ?? "");
            setDescription(d.content.summary ?? "");
            setPrice(String(d.content.price_per_block ?? "0.05"));
            setChapters(
              Array.isArray(d.chapters) && d.chapters.length
                ? d.chapters.map((c: { title?: string; body?: string }) => ({ title: c.title ?? "Untitled", body: c.body ?? "" }))
                : [{ title: "Chapter 1", body: "" }]
            );
          } else {
            toast("error", d.message ?? d.error ?? "Couldn't load that book to edit.");
          }
        } catch {
          toast("error", "Couldn't load that book to edit.");
        } finally {
          setReady(true); // autosave writer is gated on !editingId below
        }
      })();
      return;
    }
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const snap = JSON.parse(raw) as BookDraftSnapshot;
        if (snap && Array.isArray(snap.chapters) && snapshotHasContent(snap)) {
          setRestorable(snap);
          return; // keep autosave paused until the user decides
        }
        localStorage.removeItem(AUTOSAVE_KEY);
      }
    } catch {
      /* corrupt snapshot — ignore */
    }
    setReady(true);
  }, []);

  // Debounced local-only autosave (new books only; edits save server-side).
  useEffect(() => {
    if (!ready || editingId) return;
    const id = setTimeout(() => {
      try {
        const snap: BookDraftSnapshot = {
          v: AUTOSAVE_VERSION,
          title,
          coverImageUrl,
          description,
          price,
          chapters,
          savedAt: Date.now(),
        };
        if (snapshotHasContent(snap)) localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snap));
        else clearAutosave();
      } catch {
        /* storage full / unavailable — best-effort only */
      }
    }, 1200);
    return () => clearTimeout(id);
  }, [ready, editingId, title, coverImageUrl, description, price, chapters]);

  function restoreDraft() {
    if (!restorable) return;
    setTitle(restorable.title ?? "");
    setCoverImageUrl(restorable.coverImageUrl ?? "");
    setDescription(restorable.description ?? "");
    setPrice(restorable.price || "0.05");
    setChapters(restorable.chapters?.length ? restorable.chapters : [{ title: "Chapter 1", body: "" }]);
    setRestorable(null);
    setReady(true);
    toast("success", "Restored your unsaved draft.");
  }
  function discardDraft() {
    clearAutosave();
    setRestorable(null);
    setReady(true);
  }

  function updateChapter(i: number, patch: Partial<ChapterDraft>) {
    setChapters((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addChapter() {
    setChapters((cs) => [...cs, { title: `Chapter ${cs.length + 1}`, body: "" }]);
  }
  function removeChapter(i: number) {
    setChapters((cs) => (cs.length <= 1 ? cs : cs.filter((_, idx) => idx !== i)));
  }

  async function submit(status: "draft" | "published") {
    if (!title.trim()) {
      toast("warning", "Give your book a title.");
      return;
    }
    if (coverImageUrl.trim() && !isLikelyImageUrl(normalizeImageUrl(coverImageUrl.trim()))) {
      toast("warning", "That cover image link doesn't look like a valid URL.");
      return;
    }
    if (totalPages < 2) {
      toast("warning", "Add at least 2 pages. The first is a free preview. Use a `---` line to split pages.");
      return;
    }
    setBusy(true);
    try {
      const chapterPayload = chapters.map((c) => ({ title: c.title.trim() || "Untitled", body: c.body }));
      // Editing an existing book → PATCH it (updateBook replaces chapters/pages);
      // otherwise create a new one.
      const res = editingId
        ? await fetch(`/api/creator/content/${editingId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: title.trim(),
              coverImageUrl: coverImageUrl.trim() || null,
              summary: description.trim(),
              pricePerBlock: price,
              status,
              chapters: chapterPayload,
            }),
          })
        : await fetch("/api/creator/content", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              contentType: "book",
              title: title.trim(),
              coverImageUrl: coverImageUrl.trim() || undefined,
              summary: description.trim(),
              pricePerBlock: price,
              status,
              chapters: chapterPayload,
            }),
          });
      const data = await res.json();
      if (res.status === 409 && data.needsConfirm) {
        if (!confirm(`${data.paid} reader(s) have paid for this book. Editing it is recorded for review. Save anyway?`)) {
          setBusy(false);
          return;
        }
        const retry = await fetch(`/api/creator/content/${editingId}?confirm=1`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: title.trim(), coverImageUrl: coverImageUrl.trim() || null, summary: description.trim(), pricePerBlock: price, status, chapters: chapterPayload }),
        });
        if (!retry.ok) {
          const rd = await retry.json().catch(() => ({}));
          throw new Error(rd.message ?? rd.error ?? "Couldn't save the book.");
        }
        clearAutosave();
        toast("success", status === "published" ? "Book updated and live." : "Changes saved.");
        router.push("/dashboard");
        return;
      }
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Couldn't save the book.");
      // Backend is now the source of truth — drop the local crash-protection copy.
      clearAutosave();
      if (data.walletRequired) {
        toast("info", "Saved as a draft. Add a payout wallet in your dashboard to publish.");
        router.push("/dashboard");
        return;
      }
      toast("success", status === "published" ? "Book published!" : "Draft saved.");
      router.push(status === "published" && data.content?.slug ? `/read/${data.content.slug}` : "/dashboard");
    } catch (e) {
      toast("error", String((e as Error)?.message ?? e), "Publish failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-margin-mobile py-stack-lg md:px-margin-desktop">
      <Link href="/dashboard" className="inline-flex items-center gap-1 font-label-caps text-label-caps text-outline hover:text-primary">
        ← Dashboard
      </Link>
      <h1 className="mb-1 mt-3 font-display-lg text-display-lg-mobile">{editingId ? "Edit book" : "New book"}</h1>
      <p className="mb-8 font-body-md text-on-surface-variant">
        Serialized, pay-as-you-read long-form. Readers turn the page in an immersive viewer and pay per page silently.
      </p>

      {restorable && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-primary">history</span>
            <p className="font-body-sm text-on-surface-variant">
              We found unsaved changes from your last session on this device. Restore them?
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={discardDraft} className="rounded-lg border border-outline-variant px-3 py-1.5 font-body-sm hover:bg-surface-container-low">
              Discard
            </button>
            <button onClick={restoreDraft} className="btn-primary px-4 py-1.5 text-body-sm">
              Restore
            </button>
          </div>
        </div>
      )}

      {/* Book setup */}
      <section className="card mb-6 !p-0 overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-outline-variant px-5 py-4 md:px-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[20px]">menu_book</span>
          </span>
          <div>
            <h2 className="font-headline-sm text-[15px] font-semibold leading-tight">Book details</h2>
            <p className="font-body-sm text-[12px] text-on-surface-variant">Cover, blurb, and per-page price.</p>
          </div>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5 md:px-6">
          <div>
            <label className={labelClass}>Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The title of your book"
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {coverImageUrl.trim() && isLikelyImageUrl(normalizeImageUrl(coverImageUrl.trim())) && (
              <div className="h-40 w-28 shrink-0 overflow-hidden rounded-lg border border-outline-variant">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={normalizeImageUrl(coverImageUrl.trim())} alt="cover preview" className="h-full w-full object-cover" />
              </div>
            )}
            <div className="flex flex-1 flex-col gap-5">
              <div>
                <label className={labelClass}>Cover image URL (optional)</label>
                <input
                  value={coverImageUrl}
                  onChange={(e) => setCoverImageUrl(e.target.value)}
                  placeholder="https://… or a Google Drive share link"
                  className={`${inputClass} font-data-mono text-[13px]`}
                />
              </div>
              <div className="w-full sm:w-48">
                <label className={labelClass}>Price / page</label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className={`${inputClass} pr-14 font-data-mono`}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-label-caps text-label-caps text-outline">USDC</span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className={labelClass}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="A short synopsis shown on the cover card."
              className={`${inputClass} resize-y`}
            />
          </div>
        </div>
      </section>

      {/* Chapter builder */}
      <section className="mb-6 flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/10 text-secondary">
            <span className="material-symbols-outlined text-[20px]">format_list_numbered</span>
          </span>
          <div className="flex-1">
            <h2 className="font-headline-sm text-[15px] font-semibold leading-tight">Chapters</h2>
            <p className="font-body-sm text-[12px] text-on-surface-variant">
              {totalPages} page{totalPages === 1 ? "" : "s"} total · page 1 is a free preview · split pages with a <code className="rounded bg-surface-container-high px-1">---</code> line
            </p>
          </div>
        </div>

        {chapters.map((ch, i) => (
          <div key={i} className="card flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="pill shrink-0">Ch {i + 1}</span>
              <input
                value={ch.title}
                onChange={(e) => updateChapter(i, { title: e.target.value })}
                placeholder="Chapter title"
                className={`${inputClass} flex-1 py-1.5`}
              />
              <span className="hidden shrink-0 font-data-mono text-[11px] text-outline sm:inline">
                {pageCounts[i]} page{pageCounts[i] === 1 ? "" : "s"} ·{" "}
                {pageWords[i].reduce((a, b) => a + b, 0)} words
              </span>
              {chapters.length > 1 && (
                <button
                  onClick={() => removeChapter(i)}
                  className="shrink-0 text-outline transition-colors hover:text-error"
                  title="Remove chapter"
                >
                  <span className="material-symbols-outlined text-[20px]">delete</span>
                </button>
              )}
            </div>
            <textarea
              value={ch.body}
              onChange={(e) => updateChapter(i, { body: e.target.value })}
              rows={10}
              placeholder={"Paste the chapter text here (Markdown supported).\n\nSplit it into pages with a line containing only ---"}
              className={`${inputClass} resize-y font-reading text-[15px] leading-relaxed`}
            />
            {/* Live per-page word counter — pages split on `---`; book page 1 is
                the free preview. ~150-250 words/page reads well in the viewer. */}
            {pageWords[i].length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pageWords[i].map((w, p) => {
                  const globalPage = chapterPageOffset[i] + p; // 0 = free preview
                  const long = w > 280;
                  return (
                    <span
                      key={p}
                      title={long ? "This page is long — readers may have to scroll. ~150-250 words/page reads best." : undefined}
                      className={`rounded-full border px-2 py-0.5 font-data-mono text-[10px] ${
                        long ? "border-primary/40 bg-primary/5 text-primary" : "border-outline-variant text-outline"
                      }`}
                    >
                      p{globalPage + 1} · {w}w{globalPage === 0 ? " · free" : ""}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        <button onClick={addChapter} className="btn-outline flex items-center justify-center gap-1 px-4 py-2.5">
          <span className="material-symbols-outlined text-[18px]">add</span>
          Add chapter
        </button>
      </section>

      <div className="sticky bottom-4 flex items-center gap-3 rounded-xl border border-outline-variant bg-surface/95 p-3 shadow-lg backdrop-blur">
        <span className="ml-1 hidden font-data-mono text-[11px] text-outline sm:inline">
          {totalPages} page{totalPages === 1 ? "" : "s"}
        </span>
        <div className="flex flex-1 justify-end gap-2">
          <button onClick={() => submit("draft")} disabled={busy} className="btn-outline px-5 py-2.5 disabled:opacity-50">
            Save draft
          </button>
          <button onClick={() => submit("published")} disabled={busy} className="btn-primary flex items-center gap-1.5 px-6 py-2.5 disabled:opacity-50">
            <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
            {busy ? "Saving…" : editingId ? "Update book" : "Publish book"}
          </button>
        </div>
      </div>
    </div>
  );
}
