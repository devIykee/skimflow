import { NextRequest } from "next/server";
import { requireAdmin, errorResponse, HttpError } from "@/lib/session";
import { getUserById, getUsersByIds, listUsersForEmail, recordAdminEvent } from "@/lib/store";
import { emailProviderStatus, sendAdminBroadcast, sendAdminMessage } from "@/lib/email";
import { envLimit, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import type { UserRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SUBJECT = 200;
const MAX_BODY = 10_000;

const MAX_SELECTED = 100;

type EmailTarget = "user" | "selected" | "all" | "creators";

function parseTarget(raw: unknown): EmailTarget {
  if (raw === "user" || raw === "selected" || raw === "all" || raw === "creators") return raw;
  throw new HttpError(400, "bad_target", "target must be user, selected, all, or creators.");
}

function parseUserIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set(ids)];
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

/**
 * POST /api/admin/email — send a custom email to one user or a broadcast segment.
 *
 * Body: { target, userId?, userIds?, subject, body, confirmBroadcast? }
 * Broadcasts (all/creators) require confirmBroadcast: true.
 * Selected sends pass userIds (max 100).
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
      userIds?: unknown;
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
        recipient: {
          email: user.email,
          name: user.name,
          display_name: user.display_name,
          handle: user.handle,
        },
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

    if (target === "selected") {
      const userIds = parseUserIds(payload.userIds);
      if (userIds.length === 0) {
        throw new HttpError(400, "missing_users", "Select at least one user.");
      }
      if (userIds.length > MAX_SELECTED) {
        throw new HttpError(400, "too_many_users", `Select at most ${MAX_SELECTED} users per send.`);
      }

      const users = await getUsersByIds(userIds);
      const recipients = users
        .filter((u) => u.email?.trim() && !u.suspended)
        .map((u) => ({
          email: u.email,
          name: u.name,
          display_name: u.display_name,
          handle: u.handle,
        }));

      if (recipients.length === 0) {
        throw new HttpError(400, "no_recipients", "No selected users have a deliverable email.");
      }

      const { sent, failed, errors, errorSummary } = await sendAdminBroadcast(recipients, subject, body);

      await recordAdminEvent({
        eventType: "ADMIN_EMAIL",
        actorId: admin.id,
        metadata: {
          target: "selected",
          userIds,
          total: recipients.length,
          sent,
          failed,
          subject,
          errorSummary: errorSummary ?? null,
          errors: errors.length ? errors : null,
        },
      });

      const allSent = sent === recipients.length && failed === 0;
      return Response.json({
        ok: allSent,
        sent,
        failed: failed || Math.max(0, recipients.length - sent),
        total: recipients.length,
        errorSummary,
        errors: errors.length ? errors : undefined,
        message: allSent
          ? undefined
          : errorSummary ??
            (sent > 0
              ? `Only ${sent} of ${recipients.length} emails were accepted.`
              : "Send failed — check Resend logs."),
      });
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

    const { sent, failed, errors, errorSummary } = await sendAdminBroadcast(
      recipients.map((r) => ({
        email: r.email,
        name: r.name,
        display_name: r.display_name,
        handle: r.handle,
      })),
      subject,
      body
    );

    await recordAdminEvent({
      eventType: "ADMIN_EMAIL",
      actorId: admin.id,
      metadata: {
        target,
        total: recipients.length,
        sent,
        failed,
        subject,
        errorSummary: errorSummary ?? null,
        errors: errors.length ? errors : null,
      },
    });

    const allSent = sent === recipients.length && failed === 0;
    return Response.json({
      ok: allSent,
      sent,
      failed: failed || Math.max(0, recipients.length - sent),
      total: recipients.length,
      errorSummary,
      errors: errors.length ? errors : undefined,
      message: allSent
        ? undefined
        : errorSummary ??
          (sent > 0
            ? `Only ${sent} of ${recipients.length} emails were accepted.`
            : "Broadcast failed — check Resend logs and domain verification."),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** GET /api/admin/email — recipient counts + Resend config status for the compose UI. */
export async function GET() {
  try {
    const admin = await requireAdmin();
    const [all, creators] = await Promise.all([
      listUsersForEmail(),
      listUsersForEmail("creator"),
    ]);
    const provider = emailProviderStatus();
    return Response.json({
      counts: { all: all.length, creators: creators.length },
      provider,
      adminEmail: admin.email,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * PUT /api/admin/email — send a test message to the logged-in admin only.
 * Use this to verify Resend works in production before broadcasting.
 */
export async function PUT(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const payload = (await req.json().catch(() => ({}))) as { subject?: unknown; body?: unknown };
    const { subject, body } = validateContent(
      payload.subject ?? "Skimflow test email",
      payload.body ?? "If you received this, Resend is working in this environment."
    );

    const result = await sendAdminMessage({
      recipient: {
        email: admin.email,
        name: admin.name,
        display_name: admin.display_name,
        handle: admin.handle,
      },
      subject: `[Test] ${subject}`,
      body,
    });

    if (!result.ok) {
      return Response.json(
        {
          ok: false,
          error: "send_failed",
          message: result.error ?? "Test email failed.",
          provider: emailProviderStatus(),
        },
        { status: 502 }
      );
    }
    return Response.json({ ok: true, resendId: result.id, sentTo: admin.email });
  } catch (e) {
    return errorResponse(e);
  }
}