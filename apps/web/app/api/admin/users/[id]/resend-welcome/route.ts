import { requireAdmin, errorResponse, HttpError } from "@/lib/session";
import { getUserById, recordAdminEvent } from "@/lib/store";
import { sendWelcomeEmail } from "@/lib/email";
import { envLimit, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** POST /api/admin/users/:id/resend-welcome — re-send the signup welcome email. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const rl = await rateLimit({
      key: `admin:welcome:${admin.id}`,
      limit: envLimit("RATE_LIMIT_ADMIN_EMAIL", 10),
      windowSec: 60,
    });
    if (!rl.ok) return rateLimitResponse(rl);

    const { id } = await ctx.params;
    const user = await getUserById(id);
    if (!user) return Response.json({ error: "not_found" }, { status: 404 });
    if (!user.email?.trim()) throw new HttpError(400, "no_email", "User has no email address.");

    await sendWelcomeEmail({
      name: user.display_name ?? user.name ?? "there",
      email: user.email,
    });

    await recordAdminEvent({
      eventType: "ADMIN_EMAIL",
      actorId: admin.id,
      metadata: { action: "resend_welcome", userId: user.id, email: user.email },
    });

    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}