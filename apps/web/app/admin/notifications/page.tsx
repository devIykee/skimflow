"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
}

type Target = "user" | "selected" | "all" | "creators";

function AdminNotifyInner() {
  const searchParams = useSearchParams();
  const prefillUserId = searchParams.get("userId") ?? "";

  const [target, setTarget] = useState<Target>(prefillUserId ? "selected" : "user");
  const [userId, setUserId] = useState(prefillUserId);
  const [userSearch, setUserSearch] = useState("");
  const [userOptions, setUserOptions] = useState<UserRow[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Record<string, UserRow>>({});
  const [counts, setCounts] = useState({ all: 0, creators: 0 });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [confirmBroadcast, setConfirmBroadcast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/notifications", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setCounts(d.counts ?? { all: 0, creators: 0 }))
      .catch(() => {});
  }, []);

  const loadUsers = useCallback(() => {
    const p = new URLSearchParams({ limit: "50" });
    if (userSearch) p.set("search", userSearch);
    fetch(`/api/admin/users?${p}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) =>
        setUserOptions(
          (d.rows ?? []).map((u: UserRow) => ({ id: u.id, email: u.email, display_name: u.display_name }))
        )
      )
      .catch(() => {});
  }, [userSearch]);

  useEffect(() => {
    if (target !== "user" && target !== "selected") return;
    const t = setTimeout(loadUsers, 250);
    return () => clearTimeout(t);
  }, [target, loadUsers]);

  function toggleUser(u: UserRow) {
    setSelectedUsers((prev) => {
      const next = { ...prev };
      if (next[u.id]) delete next[u.id];
      else next[u.id] = u;
      return next;
    });
  }

  const selectedCount = Object.keys(selectedUsers).length;
  const broadcastTarget = target === "all" ? counts.all : counts.creators;

  async function send() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const payload: Record<string, unknown> = { target, title, body, link: link.trim() || undefined };
      if (target === "user") payload.userId = userId;
      if (target === "selected") payload.userIds = Object.keys(selectedUsers);
      if (target === "all" || target === "creators") payload.confirmBroadcast = confirmBroadcast;

      const r = await fetch("/api/admin/notifications", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.message ?? d.error ?? "Failed to send notification.");
        return;
      }
      setMsg(`Notification delivered to ${d.created ?? 0} ${d.created === 1 ? "person" : "people"}.`);
      if (target === "all" || target === "creators") setConfirmBroadcast(false);
      setSelectedUsers({});
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  const selectedUser = userOptions.find((u) => u.id === userId);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="card">
        <h2 className="mb-1 font-headline-sm text-headline-sm">Send in-app notification</h2>
        <p className="mb-6 font-body-sm text-on-surface-variant">
          Pushes a notification into the recipient&apos;s bell (top bar) and their /notifications page. No email is sent.
        </p>

        <div className="mb-4">
          <label className="mb-2 block font-label-lg text-label-lg">Recipients</label>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["user", "One user"],
                ["selected", selectedCount > 0 ? `Pick users (${selectedCount})` : "Pick users"],
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
              <p className="mt-2 font-body-sm text-on-surface-variant">Notifying {selectedUser.email}</p>
            )}
          </div>
        )}

        {target === "selected" && (
          <div className="mb-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="font-label-lg text-label-lg">Select recipients</label>
              <button
                type="button"
                onClick={() => setSelectedUsers({})}
                disabled={selectedCount === 0}
                className="btn-outline px-2 py-1 text-[11px] disabled:opacity-50"
              >
                Clear
              </button>
            </div>
            <input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search name or email…"
              className="mb-2 w-full rounded-lg border border-outline px-3 py-2 text-body-sm"
            />
            <div className="max-h-56 overflow-y-auto rounded-lg border border-outline">
              {userOptions.length === 0 ? (
                <p className="p-3 font-body-sm text-on-surface-variant">No users match your search.</p>
              ) : (
                userOptions.map((u) => (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-start gap-3 border-b border-outline-variant px-3 py-2 last:border-b-0 hover:bg-surface-variant"
                  >
                    <input type="checkbox" checked={!!selectedUsers[u.id]} onChange={() => toggleUser(u)} className="mt-1" />
                    <span>
                      <span className="block font-body-sm">{u.display_name ?? u.email}</span>
                      <span className="block text-[11px] text-outline">{u.email}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
            {selectedCount > 0 && <p className="mt-2 font-body-sm text-on-surface-variant">{selectedCount} selected</p>}
          </div>
        )}

        {(target === "all" || target === "creators") && (
          <label className="mb-4 flex items-start gap-2 rounded-lg border border-yellow-700/40 bg-yellow-50 p-3 dark:bg-yellow-950/30">
            <input
              type="checkbox"
              checked={confirmBroadcast}
              onChange={(e) => setConfirmBroadcast(e.target.checked)}
              className="mt-1"
            />
            <span className="font-body-sm text-body-sm">
              I understand this will notify <strong>{broadcastTarget}</strong>{" "}
              {target === "creators" ? "creators" : "users"} (active, non-suspended accounts only).
            </span>
          </label>
        )}

        <div className="mb-4">
          <label className="mb-2 block font-label-lg text-label-lg">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="e.g. New feature: following feed"
            className="w-full rounded-lg border border-outline px-3 py-2 text-body-sm"
          />
        </div>

        <div className="mb-4">
          <label className="mb-2 block font-label-lg text-label-lg">Message <span className="text-outline">(optional)</span></label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="Add a short detail line…"
            className="w-full rounded-lg border border-outline px-3 py-2 font-body-sm text-body-sm"
          />
        </div>

        <div className="mb-6">
          <label className="mb-2 block font-label-lg text-label-lg">Link <span className="text-outline">(optional)</span></label>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="/for-you"
            className="w-full rounded-lg border border-outline px-3 py-2 font-body-sm text-body-sm"
          />
          <p className="mt-2 font-body-sm text-[12px] text-on-surface-variant">
            Internal path only (starts with <code className="rounded bg-surface-variant px-1">/</code>). Clicking the notification opens it.
          </p>
        </div>

        {err && <p className="mb-2 font-body-sm text-red-600">{err}</p>}
        {msg && <p className="mb-3 font-body-sm text-green-700 dark:text-green-400">{msg}</p>}

        <button
          type="button"
          disabled={
            busy ||
            !title.trim() ||
            (target === "user" && !userId) ||
            (target === "selected" && selectedCount === 0) ||
            ((target === "all" || target === "creators") && !confirmBroadcast)
          }
          onClick={send}
          className="btn-primary px-5 py-2.5 disabled:opacity-50"
        >
          {busy
            ? "Sending…"
            : target === "user"
              ? "Send notification"
              : target === "selected"
                ? `Notify ${selectedCount} selected`
                : `Notify ${broadcastTarget} recipients`}
        </button>
      </div>

      <div className="card h-fit">
        <h3 className="mb-3 font-label-lg text-label-lg">How it appears</h3>
        <ul className="space-y-2 font-body-sm text-body-sm text-on-surface-variant">
          <li>· Shows a red badge on the bell in the top bar</li>
          <li>· Lands in the recipient&apos;s <code className="rounded bg-surface-variant px-1">/notifications</code> page</li>
          <li>· <strong>Title</strong> is bold; the message shows beside it</li>
          <li>· If a link is set, clicking the notification opens it</li>
          <li>· Purely in-app — this never sends an email</li>
        </ul>
      </div>
    </div>
  );
}

export default function AdminNotifyPage() {
  return (
    <Suspense fallback={<div className="card font-body-sm text-on-surface-variant">Loading…</div>}>
      <AdminNotifyInner />
    </Suspense>
  );
}
