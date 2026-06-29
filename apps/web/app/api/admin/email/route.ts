import { NextRequest } from "next/server";
import { requireAdmin, errorResponse, HttpError } from "@/lib/session";
import { getUserById, listUsersForEmail, recordAdminEvent } from "@/lib/store";
import { sendAdminMessage } from "@/lib/email";
import { envLimit, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import type { UserRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SUBJECT = 200;
const MAX_BODY = 10_000;
const BROADCAST_BATCH = 10;

type EmailTarget = "user" | "all" | "creators";

function parseTarget(raw: unknown): EmailTarget {
  if (raw === "user" || raw === "all" || raw === "creators") return raw;
  throw new HttpError(400, "bad_target", "target must be user, all, or creators.");
}

function validateContent(subject: unknown, body: unknown): { subject: string; body: string } {
  const subj = typeof subject === "string" ? subject.trim() : "";
  const text = typeof body === "string" ? body.trim() : "";
  if (!subj) throw new HttpError(400, "missing_subject", "Subject is required.");
  if (!text) throw new HttpError(400, "missing_body", "Message body is required.");
  if (subj.length > MAX_SUBJECT) throw new HttpError(400, "subject_too_long", `Subject max ${MAX_SUBJECT} chars.`);
  if (text.length > MAX_BODY) throw new HttpError(400, "body_too_long", `Body max ${MAX_BODY} chars.`);
  return { subject: subj, body: text };
}

async function sendBatch(
  recipients: Array<{ id: string; email: string; display_name: string | null; name: string | null }>,
  subject: string,
  body: string
): Promise<{ sent: number; failed: number; errors: string[] }> {
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < recipients.length; i += BROADCAST_BATCH) {
    const batch = recipients.slice(i, i + BROADCAST_BATCH);
    const results = await Promise.all(
      batch.map((r) =>
        sendAdminMessage({
          to: r.email,
          name: r.display_name ?? r.name ?? undefined,
          subject,
          body,
        })
      )
    );
    for (let j = 0; j < results.length; j++) {
      if (results[j].ok) sent++;
      else {
        failed++;
        if (errors.length < 5) errors.push(`${batch[j].email}: ${results[j].error ?? "failed"}`);
      }
    }
  }

  return { sent, failed, errors };
}

/**
 * POST /api/admin/email — send a custom email to one user or a broadcast segment.
 *
 * Body: { target: "user"|"all"|"creators", userId?, subject, body, confirmBroadcast? }
 * Broadcasts (all/creators) require confirmBroadcast: true.
 */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const rl = await rateLimit({
      key: `admin:email:${admin.id}`,
      limit: envLimit("RATE_LIMIT_ADMIN_EMAIL", 10),
      windowSec: 60,
    });
    if (!rl.ok) return rateLimitResponse(rl);

    const payload = (await req.json().catch(() => ({}))) as {
      target?: unknown;
      userId?: unknown;
      subject?: unknown;
      body?: unknown;
      confirmBroadcast?: unknown;
    };

    const target = parseTarget(payload.target);
    const { subject, body } = validateContent(payload.subject, payload.body);

    if (target === "user") {
      const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
      if (!userId) throw new HttpError(400, "missing_user", "userId is required for target=user.");

      const user = await getUserById(userId);
      if (!user) throw new HttpError(404, "not_found", "User not found.");
      if (!user.email?.trim()) throw new HttpError(400, "no_email", "User has no email address.");
      if (user.suspended) throw new HttpError(400, "user_suspended", "Cannot email a suspended user.");

      const result = await sendAdminMessage({
        to: user.email,
        name: user.display_name ?? user.name ?? undefined,
        subject,
        body,
      });

      await recordAdminEvent({
        eventType: "ADMIN_EMAIL",
        actorId: admin.id,
        metadata: {
          target: "user",
          userId: user.id,
          email: user.email,
          subject,
          ok: result.ok,
          resendId: result.id ?? null,
          error: result.error ?? null,
        },
      });

      if (!result.ok) {
        return Response.json(
          { ok: false, error: "send_failed", message: result.error ?? "Email failed to send." },
          { status: 502 }
        );
      }
      return Response.json({ ok: true, sent: 1, failed: 0, total: 1, resendId: result.id });
    }

    if (payload.confirmBroadcast !== true) {
      throw new HttpError(
        400,
        "confirm_required",
        "Set confirmBroadcast: true to send to all users or all creators."
      );
    }

    const role: UserRole | undefined = target === "creators" ? "creator" : undefined;
    const recipients = await listUsersForEmail(role);
    if (recipients.length === 0) {
      return Response.json({ ok: true, sent: 0, failed: 0, total: 0, message: "No recipients matched." });
    }

    const { sent, failed, errors } = await sendBatch(recipients, subject, body);

    await recordAdminEvent({
      eventType: "ADMIN_EMAIL",
      actorId: admin.id,
      metadata: {
        target,
        total: recipients.length,
        sent,
        failed,
        subject,
        errors: errors.length ? errors : null,
      },
    });

    return Response.json({
      ok: failed === 0,
      sent,
      failed,
      total: recipients.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** GET /api/admin/email — recipient counts for the compose UI. */
export async function GET() {
  try {
    await requireAdmin();
    const [all, creators] = await Promise.all([
      listUsersForEmail(),
      listUsersForEmail("creator"),
    ]);
    return Response.json({
      counts: { all: all.length, creators: creators.length },
    });
  } catch (e) {
    return errorResponse(e);
  }
}