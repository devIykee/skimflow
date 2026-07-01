import { NextRequest } from "next/server";
import { requireAdmin, errorResponse, HttpError } from "@/lib/session";
import {
  countActiveUsers,
  createAdminNotifications,
  getUsersByIds,
  listActiveUserIds,
  recordAdminEvent,
} from "@/lib/store";
import { envLimit, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import type { UserRole } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TITLE = 200;
const MAX_BODY = 2_000;
const MAX_SELECTED = 500;

type Target = "user" | "selected" | "all" | "creators";

function parseTarget(raw: unknown): Target {
  if (raw === "user" || raw === "selected" || raw === "all" || raw === "creators") return raw;
  throw new HttpError(400, "bad_target", "target must be user, selected, all, or creators.");
}

function parseUserIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean)
    ),
  ];
}

/** Title required; body optional; link, if present, must be an internal path (starts with "/"). */
function validate(payload: { title?: unknown; body?: unknown; link?: unknown }): {
  title: string;
  body: string;
  link: string | null;
} {
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!title) throw new HttpError(400, "missing_title", "Title is required.");
  if (title.length > MAX_TITLE) throw new HttpError(400, "title_too_long", `Title max ${MAX_TITLE} chars.`);
  if (body.length > MAX_BODY) throw new HttpError(400, "body_too_long", `Message max ${MAX_BODY} chars.`);
  let link: string | null = null;
  if (typeof payload.link === "string" && payload.link.trim()) {
    const l = payload.link.trim();
    if (!l.startsWith("/")) {
      throw new HttpError(400, "bad_link", "Link must be an internal path starting with '/' (e.g. /for-you).");
    }
    link = l;
  }
  return { title, body, link };
}

/** GET — recipient counts for the composer UI. */
export async function GET() {
  try {
    await requireAdmin();
    const [all, creators] = await Promise.all([countActiveUsers(), countActiveUsers("creator")]);
    return Response.json({ counts: { all, creators } });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/admin/notifications — push an in-app notification into users' bells.
 * Body: { target, userId?, userIds?, title, body?, link?, confirmBroadcast? }.
 * Broadcasts (all/creators) require confirmBroadcast: true.
 */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const rl = await rateLimit({
      key: `admin:notify:${admin.id}`,
      limit: envLimit("RATE_LIMIT_ADMIN_NOTIFY", 20),
      windowSec: 60,
    });
    if (!rl.ok) return rateLimitResponse(rl);

    const payload = (await req.json().catch(() => ({}))) as {
      target?: unknown;
      userId?: unknown;
      userIds?: unknown;
      title?: unknown;
      body?: unknown;
      link?: unknown;
      confirmBroadcast?: unknown;
    };

    const target = parseTarget(payload.target);
    const { title, body, link } = validate(payload);

    // Resolve the target to a concrete, existing set of user ids.
    let userIds: string[];
    if (target === "user") {
      const id = typeof payload.userId === "string" ? payload.userId.trim() : "";
      if (!id) throw new HttpError(400, "missing_user", "userId is required for target=user.");
      const users = await getUsersByIds([id]);
      if (users.length === 0) throw new HttpError(404, "not_found", "User not found.");
      userIds = [users[0].id];
    } else if (target === "selected") {
      const ids = parseUserIds(payload.userIds);
      if (ids.length === 0) throw new HttpError(400, "missing_users", "Select at least one user.");
      if (ids.length > MAX_SELECTED) throw new HttpError(400, "too_many_users", `Select at most ${MAX_SELECTED} users.`);
      // Keep only ids that resolve to real users (avoids FK failures on the insert).
      const users = await getUsersByIds(ids);
      userIds = users.map((u) => u.id);
      if (userIds.length === 0) throw new HttpError(400, "no_recipients", "No valid recipients selected.");
    } else {
      if (payload.confirmBroadcast !== true) {
        throw new HttpError(400, "confirm_required", "Set confirmBroadcast: true to notify all users or all creators.");
      }
      const role: UserRole | undefined = target === "creators" ? "creator" : undefined;
      userIds = (await listActiveUserIds(role)).map((r) => r.id);
      if (userIds.length === 0) {
        return Response.json({ ok: true, created: 0, message: "No recipients matched." });
      }
    }

    const created = await createAdminNotifications(userIds, { title, body, link });

    void recordAdminEvent({
      eventType: "ADMIN_EMAIL",
      actorId: admin.id,
      metadata: { kind: "in_app_notification", target, created, title, link },
    });

    return Response.json({ ok: true, created, total: userIds.length });
  } catch (e) {
    return errorResponse(e);
  }
}
