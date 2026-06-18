import { NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/session";
import { isHandleTaken, normalizeHandle, updateProfile } from "@/lib/store";
import { rateLimit, rateLimitResponse, clientIp, envLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Length caps so cards never break.
const MAX_NAME = 32;
const MAX_HANDLE = 24;
const MAX_BIO = 160;

/** Current editable profile for the signed-in creator. */
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({
      displayName: user.display_name ?? "",
      handle: user.handle ?? "",
      bio: user.bio ?? "",
      avatar: user.avatar,
      email: user.email,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Update display name, @handle (unique), and bio. */
export async function PATCH(req: NextRequest) {
  try {
    const rl = await rateLimit({ key: `profile:${clientIp(req.headers)}`, limit: envLimit("RATE_LIMIT_AUTH", 20), windowSec: 60 });
    if (!rl.ok) return rateLimitResponse(rl);

    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as { displayName?: string; handle?: string; bio?: string };

    const displayName = (body.displayName ?? "").trim().slice(0, MAX_NAME);
    if (!displayName) return Response.json({ error: "bad_name", friendly: "Display name is required." }, { status: 400 });

    const rawHandle = (body.handle ?? "").trim();
    if (!rawHandle) return Response.json({ error: "bad_handle", friendly: "Handle is required." }, { status: 400 });
    const handle = normalizeHandle(rawHandle).slice(0, MAX_HANDLE);
    if (handle.length < 3) {
      return Response.json({ error: "bad_handle", friendly: "Handle must be at least 3 letters/numbers." }, { status: 400 });
    }
    if (await isHandleTaken(handle, user.id)) {
      return Response.json({ error: "handle_taken", friendly: `@${handle} is taken — try another.` }, { status: 409 });
    }

    const bio = (body.bio ?? "").trim().slice(0, MAX_BIO);

    const result = await updateProfile(user.id, { displayName, handle, bio });
    if (!result.ok) {
      return Response.json({ error: "handle_taken", friendly: `@${handle} is taken — try another.` }, { status: 409 });
    }
    return Response.json({
      ok: true,
      displayName: result.user.display_name,
      handle: result.user.handle,
      bio: result.user.bio,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
