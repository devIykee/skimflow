"use client";

import { useEffect, useRef, useState } from "react";

interface FeedEvent {
  id: string;
  event_type: string;
  payer_id: string | null;
  content_id: string | null;
  block_index: number | null;
  amount_gross: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const BADGE: Record<string, { icon: string; label: string; color: string }> = {
  UNLOCK: { icon: "lock_open", label: "UNLOCK", color: "text-green-600" },
  AGENT_UNLOCK: { icon: "smart_toy", label: "AGENT_UNLOCK", color: "text-blue-600" },
  PUBLISH: { icon: "publish", label: "PUBLISH", color: "text-amber-600" },
  SIGNUP: { icon: "person_add", label: "SIGNUP", color: "text-purple-600" },
  PAYOUT: { icon: "payments", label: "PAYOUT", color: "text-rose-600" },
  "402_HIT": { icon: "request_quote", label: "402_HIT", color: "text-on-surface-variant" },
  WEBHOOK_REJECTED: { icon: "report", label: "WEBHOOK_REJECTED", color: "text-orange-600" },
  IMPERSONATE: { icon: "visibility", label: "IMPERSONATE", color: "text-red-700" },
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Prepend new events, drop any whose id is already present, cap at 500. */
function mergeEvents(incoming: FeedEvent[], existing: FeedEvent[]): FeedEvent[] {
  const seen = new Set(existing.map((e) => e.id));
  const fresh = incoming.filter((e) => !seen.has(e.id));
  if (!fresh.length) return existing;
  return [...fresh, ...existing].slice(0, 500);
}

function describe(e: FeedEvent): string {
  const who = e.payer_id ? e.payer_id.replace(/^(0x.{4}).+(.{4})$/, "$1…$2") : "system";
  switch (e.event_type) {
    case "UNLOCK":
      return `${who} unlocked block ${e.block_index} (${e.amount_gross ?? "?"} USDC)`;
    case "AGENT_UNLOCK":
      return `agent unlocked block ${e.block_index} (${e.amount_gross ?? "?"} USDC)`;
    case "402_HIT":
      return `agent hit 402 on block ${e.block_index}`;
    case "PUBLISH":
      return `creator published "${(e.metadata?.title as string) ?? "content"}"`;
    case "SIGNUP":
      return `new creator ${(e.metadata?.email as string) ?? ""} (${(e.metadata?.provider as string) ?? "?"})`;
    case "PAYOUT":
      return `payout ${e.amount_gross ?? "?"} USDC`;
    case "WEBHOOK_REJECTED":
      return `webhook rejected: ${(e.metadata?.reason as string) ?? "bad signature"}`;
    case "IMPERSONATE":
      return `admin impersonation ${(e.metadata?.action as string) ?? ""}`;
    case "ADMIN_EMAIL":
      return (e.metadata?.action as string) === "resend_welcome"
        ? `resent welcome to ${(e.metadata?.email as string) ?? "user"}`
        : `admin email → ${(e.metadata?.target as string) ?? "?"} (${(e.metadata?.sent as number) ?? 1} sent)`;
    default:
      return e.event_type;
  }
}

export default function ActivityFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const pausedRef = useRef(false);
  const pendingRef = useRef<FeedEvent[]>([]);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused && pendingRef.current.length) {
      const buffered = pendingRef.current.reverse();
      setEvents((prev) => mergeEvents(buffered, prev));
      pendingRef.current = [];
      setNewCount(0);
    }
  }, [paused]);

  useEffect(() => {
    const es = new EventSource("/api/admin/activity-stream", { withCredentials: true });
    es.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as FeedEvent;
        if (pausedRef.current) {
          if (!pendingRef.current.some((p) => p.id === ev.id)) {
            pendingRef.current.push(ev);
            setNewCount(pendingRef.current.length);
          }
        } else {
          setEvents((prev) => mergeEvents([ev], prev));
        }
      } catch {
        /* ignore keepalives / parse errors */
      }
    };
    return () => es.close();
  }, []);

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-headline-sm text-headline-sm">Live Activity</h2>
        <div className="flex items-center gap-3">
          {paused && newCount > 0 && (
            <span className="rounded-full bg-primary px-3 py-1 font-label-caps text-label-caps text-on-primary">
              {newCount} new
            </span>
          )}
          <button onClick={() => setPaused((p) => !p)} className="btn-outline px-4 py-1 text-label-lg">
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {events.length === 0 && (
          <p className="font-body-sm text-on-surface-variant">Waiting for events…</p>
        )}
        <ul className="flex flex-col gap-1">
          {events.map((e) => {
            const b = BADGE[e.event_type] ?? { icon: "circle", label: e.event_type, color: "text-on-surface-variant" };
            return (
              <li key={e.id} className="flex items-center gap-3 border-b border-outline-variant py-2 text-body-sm">
                <span title={new Date(e.created_at).toLocaleString()} className="w-16 shrink-0 font-data-mono text-[11px] text-outline">
                  {relTime(e.created_at)}
                </span>
                <span className="flex w-40 shrink-0 items-center gap-1.5 font-label-caps text-label-caps">
                  <span className={`material-symbols-outlined text-[16px] ${b.color}`}>{b.icon}</span>
                  {b.label}
                </span>
                <span className="flex-grow text-on-surface-variant">{describe(e)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
