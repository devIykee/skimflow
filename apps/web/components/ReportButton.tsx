"use client";

import { useState } from "react";
import { useToast } from "@/components/Toaster";

const REASONS: { value: string; label: string }[] = [
  { value: "copyright", label: "Copyright violation" },
  { value: "scam", label: "Scam / fraud" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "other", label: "Other" },
];

/**
 * "Report this post" — a general content-report action available on any content
 * (§2c). Files a content_report into the admin reports inbox. Broken-image
 * reports (§5b) use the /api/reports endpoint directly with reportType
 * "broken_link", not this button.
 */
export default function ReportButton({ contentSlug }: { contentSlug: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("copyright");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportType: "content_report", reason, detail, contentSlug }),
      });
      if (!res.ok) throw new Error();
      toast("success", "Thanks — this report has been sent to our team for review.");
      setOpen(false);
      setDetail("");
    } catch {
      toast("error", "Couldn't send the report. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 font-body-sm text-[12px] text-outline hover:text-primary"
        title="Report this post"
      >
        <span className="material-symbols-outlined text-[15px]">flag</span>
        Report
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-2xl border border-outline-variant bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 font-headline-sm text-headline-sm">Report this post</h2>
            <label className="mb-1 block font-label-caps text-label-caps text-outline">Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mb-3 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-on-surface"
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <label className="mb-1 block font-label-caps text-label-caps text-outline">Details (optional)</label>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              className="mb-4 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-body-sm text-on-surface"
              placeholder="What's wrong with this post?"
            />
            <div className="flex gap-3">
              <button onClick={() => setOpen(false)} disabled={busy} className="flex-1 rounded-lg border border-outline-variant px-4 py-2.5 font-body-md text-on-surface hover:bg-surface-container-low">
                Cancel
              </button>
              <button onClick={submit} disabled={busy} className="btn-primary flex-[2] px-4 py-2.5">
                {busy ? "Sending…" : "Send report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
