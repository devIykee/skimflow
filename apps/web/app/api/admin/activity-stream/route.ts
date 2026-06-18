import { NextRequest } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/session";
import { adminEventsAfter, adminEventsSince, recentAdminEvents } from "@/lib/store";
import { sseAcquire, sseRelease } from "@/lib/sse-registry";
import { envLimit } from "@/lib/rate-limit";
import type { AdminEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// On serverless (Vercel) a function is capped at its platform timeout. Hold the
// SSE stream for up to 60s, then let the browser's EventSource auto-reconnect
// (Last-Event-ID replay picks up any events missed during the gap).
export const maxDuration = 60;

const POLL_MS = 2000;

/**
 * GET /api/admin/activity-stream — Server-Sent Events feed of admin_events.
 * Supports Last-Event-ID: on reconnect, replays up to 20 events newer than the
 * given id before resuming live polling. Each event carries an `id:` (the
 * admin_events UUID). Capped at RATE_LIMIT_ADMIN_SSE concurrent per admin.
 */
export async function GET(req: NextRequest) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (e) {
    return errorResponse(e);
  }

  const max = envLimit("RATE_LIMIT_ADMIN_SSE", 5);
  if (!sseAcquire(admin.id, max)) {
    return Response.json(
      { error: "Rate limit exceeded", retry_after_seconds: 30 },
      { status: 429, headers: { "Retry-After": "30" } }
    );
  }

  const lastEventId = req.headers.get("last-event-id");
  const encoder = new TextEncoder();
  let cursor: Date = new Date();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const release = () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    sseRelease(admin.id);
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: AdminEvent) => {
        // No `event:` line so the browser's default onmessage receives all of
        // them; the type lives in the JSON payload (ev.event_type).
        controller.enqueue(encoder.encode(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`));
        cursor = ev.created_at instanceof Date ? ev.created_at : new Date(ev.created_at);
      };

      // Open the stream.
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Replay on reconnect, else start the cursor at the latest known event.
      if (lastEventId) {
        const replay = await adminEventsSince(lastEventId, 20);
        for (const ev of replay) send(ev);
        if (replay.length === 0) {
          const latest = (await recentAdminEvents(1))[0];
          if (latest) cursor = latest.created_at instanceof Date ? latest.created_at : new Date(latest.created_at);
        }
      } else {
        const latest = (await recentAdminEvents(1))[0];
        if (latest) cursor = latest.created_at instanceof Date ? latest.created_at : new Date(latest.created_at);
      }

      timer = setInterval(async () => {
        if (closed) return;
        try {
          const fresh = await adminEventsAfter(cursor, 50);
          for (const ev of fresh) send(ev);
          controller.enqueue(encoder.encode(": ping\n\n")); // keepalive
        } catch {
          /* swallow transient poll errors */
        }
      }, POLL_MS);

      req.signal.addEventListener("abort", () => {
        release();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      release();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Critical for nginx/proxies: disable buffering so events flush live.
      "X-Accel-Buffering": "no",
    },
  });
}
