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
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirmBroadcast, setConfirmBroadcast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/email", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setCounts(d.counts ?? { all: 0, creators: 0 }))
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

  async function send() {
    setBusy(true);
    setMsg(null);
    setErr(null);
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
        return;
      }
      if (target === "user") {
        setMsg("Email sent.");
      } else {
        setMsg(`Sent ${d.sent ?? 0} of ${d.total ?? 0}${d.failed ? ` (${d.failed} failed)` : ""}.`);
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
        </div>

        {err && <p className="mb-3 font-body-sm text-red-600">{err}</p>}
        {msg && <p className="mb-3 font-body-sm text-green-700 dark:text-green-400">{msg}</p>}

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
      </div>

      <div className="card h-fit">
        <h3 className="mb-3 font-label-lg text-label-lg">Quick actions</h3>
        <p className="mb-4 font-body-sm text-on-surface-variant">
          Resend the automated welcome email from the Users tab, or use this form for custom announcements.
        </p>
        <ul className="space-y-2 font-body-sm text-body-sm text-on-surface-variant">
          <li>· Welcome emails also send automatically on signup</li>
          <li>· Payout emails send when transfers confirm</li>
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