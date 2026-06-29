"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
}

type Target = "user" | "all" | "creators";

function AdminEmailInner() {
  const searchParams = useSearchParams();
  const prefillUserId = searchParams.get("userId") ?? "";

  const [target, setTarget] = useState<Target>(prefillUserId ? "user" : "user");
  const [userId, setUserId] = useState(prefillUserId);
  const [userSearch, setUserSearch] = useState("");
  const [userOptions, setUserOptions] = useState<UserRow[]>([]);
  const [counts, setCounts] = useState({ all: 0, creators: 0 });
  const [provider, setProvider] = useState<{ configured: boolean; from?: string; missing: string[] } | null>(null);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirmBroadcast, setConfirmBroadcast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [errDetails, setErrDetails] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/admin/email", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setCounts(d.counts ?? { all: 0, creators: 0 });
        setProvider(d.provider ?? null);
        setAdminEmail(d.adminEmail ?? null);
      })
      .catch(() => {});
  }, []);

  const loadUsers = useCallback(() => {
    const p = new URLSearchParams({ limit: "20" });
    if (userSearch) p.set("search", userSearch);
    fetch(`/api/admin/users?${p}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setUserOptions(
          (d.rows ?? []).map((u: UserRow) => ({
            id: u.id,
            email: u.email,
            display_name: u.display_name,
          }))
        );
      })
      .catch(() => {});
  }, [userSearch]);

  useEffect(() => {
    if (target !== "user") return;
    const t = setTimeout(loadUsers, 250);
    return () => clearTimeout(t);
  }, [target, loadUsers]);

  useEffect(() => {
    if (prefillUserId) setUserId(prefillUserId);
  }, [prefillUserId]);

  async function sendTest() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    setErrDetails([]);
    try {
      const r = await fetch("/api/admin/email", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim() || "Skimflow test",
          body: body.trim() || "If you received this, Resend is working in production.",
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.message ?? d.error ?? "Test send failed.");
        if (d.provider?.missing?.length) {
          setErrDetails([`Missing env: ${d.provider.missing.join(", ")}`]);
        }
        return;
      }
      setMsg(`Test email sent to ${d.sentTo}.`);
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    setErrDetails([]);
    try {
      const payload: Record<string, unknown> = { target, subject, body };
      if (target === "user") payload.userId = userId;
      if (target !== "user") payload.confirmBroadcast = confirmBroadcast;

      const r = await fetch("/api/admin/email", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.message ?? d.error ?? "Send failed.");
        if (Array.isArray(d.errors)) setErrDetails(d.errors);
        return;
      }
      if (target === "user") {
        setMsg("Email sent.");
      } else if (d.failed > 0) {
        setErr(d.message ?? d.errorSummary ?? `All ${d.failed} sends failed.`);
        if (Array.isArray(d.errors)) setErrDetails(d.errors);
      } else {
        setMsg(`Sent ${d.sent ?? 0} of ${d.total ?? 0}.`);
      }
      if (target !== "user") setConfirmBroadcast(false);
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  const selectedUser = userOptions.find((u) => u.id === userId);
  const broadcastTarget = target === "all" ? counts.all : counts.creators;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="card">
        <h2 className="mb-1 font-headline-sm text-headline-sm">Send email</h2>
        <p className="mb-6 font-body-sm text-on-surface-variant">
          Compose a message to one user or broadcast to everyone on Skimflow.
        </p>

        <div className="mb-4">
          <label className="mb-2 block font-label-lg text-label-lg">Recipients</label>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["user", "One user"],
                ["creators", `All creators (${counts.creators})`],
                ["all", `All users (${counts.all})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTarget(value)}
                className={`rounded-lg border px-3 py-2 text-body-sm transition-colors ${
                  target === value
                    ? "border-primary bg-primary-container text-on-primary-container"
                    : "border-outline hover:bg-surface-variant"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {target === "user" && (
          <div className="mb-4">
            <label className="mb-2 block font-label-lg text-label-lg">Find user</label>
            <input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search name or email…"
              className="mb-2 w-full rounded-lg border border-outline px-3 py-2 text-body-sm"
            />
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full rounded-lg border border-outline px-3 py-2 text-body-sm"
            >
              <option value="">Select a user…</option>
              {userOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name ?? u.email} · {u.email}
                </option>
              ))}
            </select>
            {selectedUser && (
              <p className="mt-2 font-body-sm text-on-surface-variant">Sending to {selectedUser.email}</p>
            )}
          </div>
        )}

        {target !== "user" && (
          <label className="mb-4 flex items-start gap-2 rounded-lg border border-yellow-700/40 bg-yellow-50 p-3 dark:bg-yellow-950/30">
            <input
              type="checkbox"
              checked={confirmBroadcast}
              onChange={(e) => setConfirmBroadcast(e.target.checked)}
              className="mt-1"
            />
            <span className="font-body-sm text-body-sm">
              I understand this will email <strong>{broadcastTarget}</strong>{" "}
              {target === "creators" ? "creators" : "users"} (active, non-suspended accounts only).
            </span>
          </label>
        )}

        <div className="mb-4">
          <label className="mb-2 block font-label-lg text-label-lg">Subject</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            placeholder="What's this about?"
            className="w-full rounded-lg border border-outline px-3 py-2 text-body-sm"
          />
        </div>

        <div className="mb-6">
          <label className="mb-2 block font-label-lg text-label-lg">Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            maxLength={10000}
            placeholder="Write your message…"
            className="w-full rounded-lg border border-outline px-3 py-2 font-body-sm text-body-sm"
          />
          <p className="mt-2 font-body-sm text-[12px] text-on-surface-variant">
            Links: paste a URL directly, or use{" "}
            <code className="rounded bg-surface-variant px-1">[link text](https://…)</code>
          </p>
        </div>

        {provider && !provider.configured && (
          <p className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 font-body-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
            Resend is not configured in this environment. Set{" "}
            <strong>{provider.missing.join(", ")}</strong> in Vercel → Settings → Environment Variables, then redeploy.
          </p>
        )}

        {err && <p className="mb-2 font-body-sm text-red-600">{err}</p>}
        {errDetails.length > 0 && (
          <ul className="mb-3 list-inside list-disc font-body-sm text-[12px] text-red-600">
            {errDetails.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {msg && <p className="mb-3 font-body-sm text-green-700 dark:text-green-400">{msg}</p>}

        <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={
            busy ||
            !subject.trim() ||
            !body.trim() ||
            (target === "user" && !userId) ||
            (target !== "user" && !confirmBroadcast)
          }
          onClick={send}
          className="btn-primary px-5 py-2.5 disabled:opacity-50"
        >
          {busy ? "Sending…" : target === "user" ? "Send email" : `Send to ${broadcastTarget} recipients`}
        </button>
        <button
          type="button"
          disabled={busy || !adminEmail}
          onClick={sendTest}
          className="btn-outline px-5 py-2.5 disabled:opacity-50"
        >
          Send test to me
        </button>
        </div>
      </div>

      <div className="card h-fit">
        <h3 className="mb-3 font-label-lg text-label-lg">Production checklist</h3>
        <ul className="space-y-2 font-body-sm text-body-sm text-on-surface-variant">
          <li>· <strong>Send test to me</strong> first — uses your real inbox, not Resend&apos;s sandbox address</li>
          <li>· Verify your domain in Resend → Domains (must match <code className="rounded bg-surface-variant px-1">{provider?.from ?? "RESEND_FROM_EMAIL"}</code> exactly)</li>
          <li>· Set <code className="rounded bg-surface-variant px-1">RESEND_API_KEY</code> and <code className="rounded bg-surface-variant px-1">RESEND_FROM_EMAIL</code> in Vercel, then redeploy</li>
          <li>· Broadcasts skip suspended accounts</li>
        </ul>
      </div>
    </div>
  );
}

export default function AdminEmailPage() {
  return (
    <Suspense fallback={<div className="card font-body-sm text-on-surface-variant">Loading…</div>}>
      <AdminEmailInner />
    </Suspense>
  );
}