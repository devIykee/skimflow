import { NextRequest } from "next/server";
import { errorResponse, HttpError } from "@/lib/session";
import { listFollowers, listFollowing, type PublicUserRow } from "@/lib/store";
import { publicName } from "@/lib/creator-posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serialize(u: PublicUserRow) {
  return { id: u.id, name: publicName(u), handle: u.handle, avatarUrl: u.avatar, bio: u.bio };
}

/** GET /api/follows/:userId/list?type=followers|following — public list for the stats modal. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await ctx.params;
    if (!UUID_RE.test(userId)) throw new HttpError(400, "invalid_user_id", "Invalid user id.");
    const type = req.nextUrl.searchParams.get("type") === "following" ? "following" : "followers";
    const rows = type === "following" ? await listFollowing(userId) : await listFollowers(userId);
    return Response.json({ type, users: rows.map(serialize) });
  } catch (e) {
    return errorResponse(e);
  }
}
