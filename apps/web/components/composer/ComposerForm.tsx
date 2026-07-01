"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/Toaster";

// ─────────────────────────────────────────────────────────────────────────────
// Frictionless quick-post composer. A quick post is a published FREE article
// (single free block, price 0) via POST /api/creator/content. The whole thought
// is normalized into ONE block so it never trips multi-chunk publish validation.
// Optimistic: the feed shows the post immediately via callbacks, before the
// server confirms. Draft text is preserved in localStorage across navigations.
// ─────────────────────────────────────────────────────────────────────────────

const LIMIT = 2000;
const COUNTER_AT = Math.floor(LIMIT * 0.8);

const PROMPTS = [
  "What are you thinking about right now?",
  "Drop an update for your readers",
  "Share a quick thought…",
  "What did you learn today?",
  "Start a conversation",
];

export interface OptimisticPost {
  tempId: string;
  title: string;
  summary: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null; handle: string | null; avatarUrl: string | null };
}

/** Minimal shape of the created `content` row returned by the API. */
export interface CreatedContent {
  id: string;
  slug: string;
  title: string;
  summary: string;
  content_type: string;
  price_per_block: string;
  block_count: number;
  created_at: string;
  published_at: string | null;
}

export interface ComposerCallbacks {
  onPending: (temp: OptimisticPost) => void;
  onSuccess: (tempId: string, content: CreatedContent) => void;
  onError: (tempId: string) => void;
}

const IMG_RE = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|svg)(\?\S*)?$/i;

/** First line (or first 80 chars) → a title for the article. */
function deriveTitle(text: string): string {
  const firstLine = text.trim().split(/\n/)[0]?.trim() ?? "";
  const base = firstLine || text.trim();
  if (!base) return "New post";
  return base.length > 80 ? `${base.slice(0, 79).trimEnd()}…` : base;
}

export default function ComposerForm({
  surface,
  callbacks,
  variant = "inline",
  autoFocus = false,
  onClose,
}: {
  surface: string;
  callbacks: ComposerCallbacks;
  variant?: "inline" | "fullscreen";
  autoFocus?: boolean;
  onClose?: () => void;
}) {
  const { data: session } = useSession();
  const toast = useToast();
  const draftKey = `skimflow:composer:${surface}`;

  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failedText, setFailedText] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Session-stable rotating placeholder (same prompt for the whole session).
  const placeholder = useMemo(() => {
    if (typeof window === "undefined") return PROMPTS[0];
    const key = "skimflow:composer:prompt";
    let idx = Number(sessionStorage.getItem(key));
    if (!Number.isFinite(idx) || sessionStorage.getItem(key) === null) {
      idx = Math.floor((Date.now() / 1000) % PROMPTS.length);
      sessionStorage.setItem(key, String(idx));
    }
    return PROMPTS[idx % PROMPTS.length];
  }, []);

  // Restore + persist the draft.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) setText(saved);
    } catch {
      /* ignore */
    }
  }, [draftKey]);
  useEffect(() => {
    try {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
  }, [text, draftKey]);

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  const canPost = text.trim().length > 0 && !submitting;

  function maybeAttachImageFromText(pasted: string): boolean {
    const t = pasted.trim();
    if (IMG_RE.test(t)) {
      setImageUrl(t);
      return true;
    }
    return false;
  }

  async function submit() {
    if (!canPost) return;
    const raw = text.trim();
    setSubmitting(true);
    setFailedText(null);

    // One free block: collapse blank lines so the server never multi-chunks.
    let body = raw;
    if (imageUrl) body += `\n![image](${imageUrl})`;
    body = body.replace(/\n{2,}/g, "\n");
    const title = deriveTitle(raw);
    const summary = raw.slice(0, 200);

    const tempId = `temp-${Date.now()}`;
    const u = session?.user;
    callbacks.onPending({
      tempId,
      title,
      summary,
      body: raw,
      createdAt: new Date().toISOString(),
      author: {
        id: u?.id ?? "",
        name: u?.name ?? null,
        handle: u?.handle ?? null,
        avatarUrl: u?.image ?? null,
      },
    });

    // Clear the input immediately (optimistic); keep a copy to restore on failure.
    setText("");
    setImageUrl(null);
    onClose?.();

    try {
      const res = await fetch("/api/creator/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, contentType: "article", body, summary, status: "published", pricePerBlock: "0" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? String(res.status));
      if (data.walletRequired) {
        // Saved as a draft, not published — it won't appear in the feed.
        callbacks.onError(tempId);
        toast("info", "Saved as a draft — finish wallet setup to publish.");
        return;
      }
      callbacks.onSuccess(tempId, data.content as CreatedContent);
      toast("success", "Posted.");
    } catch {
      callbacks.onError(tempId);
      setFailedText(raw);
      toast("error", "Couldn't post. Your text is saved — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  const initial = (session?.user?.name ?? "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className={variant === "fullscreen" ? "flex flex-col gap-3" : "flex gap-3"}>
      {/* Current-user avatar reinforces "you". */}
      {variant === "inline" &&
        (session?.user?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.user.image} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-label-caps text-[13px] text-primary">
            {initial}
          </span>
        ))}

      <div className="min-w-0 flex-1">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, LIMIT))}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (t && maybeAttachImageFromText(t)) e.preventDefault();
            else if (e.clipboardData.files.length > 0 && !t) {
              e.preventDefault();
              toast("info", "Paste an image link (URL) — file uploads aren't supported yet.");
            }
          }}
          onDrop={(e) => {
            const t = e.dataTransfer.getData("text");
            if (t && maybeAttachImageFromText(t)) e.preventDefault();
          }}
          rows={variant === "fullscreen" ? 8 : 2}
          placeholder={placeholder}
          className="w-full resize-none rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 font-body-md text-body-md text-on-surface placeholder:text-outline focus:border-primary focus:outline-none"
        />

        {imageUrl && (
          <div className="mt-2 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
            <button onClick={() => setImageUrl(null)} className="font-label-caps text-label-caps text-outline hover:text-primary">
              remove image
            </button>
          </div>
        )}

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {text.length >= COUNTER_AT && (
              <span
                className={`font-data-mono text-[12px] ${text.length >= LIMIT ? "text-primary" : "text-outline"}`}
              >
                {text.length} / {LIMIT}
              </span>
            )}
            {failedText && (
              <button
                onClick={() => {
                  setText(failedText);
                  setFailedText(null);
                }}
                className="font-label-caps text-label-caps text-primary hover:underline"
              >
                Retry
              </button>
            )}
            <span className="hidden font-data-mono text-[11px] text-outline sm:inline">⌘/Ctrl + Enter</span>
          </div>

          <div className="flex items-center gap-2">
            {onClose && (
              <button onClick={onClose} className="font-label-caps text-label-caps text-on-surface-variant hover:text-on-surface">
                Cancel
              </button>
            )}
            <motion.button
              type="button"
              onClick={submit}
              disabled={!canPost}
              whileTap={canPost ? { scale: 0.97 } : undefined}
              animate={{ scale: canPost ? 1 : 0.98 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className={`inline-flex items-center gap-1 rounded-full px-5 py-1.5 font-label-caps text-label-caps transition-colors ${
                canPost
                  ? "bg-primary text-on-primary hover:bg-primary/90"
                  : "cursor-not-allowed bg-surface-container-high text-outline"
              }`}
            >
              {submitting && <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>}
              Post
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
