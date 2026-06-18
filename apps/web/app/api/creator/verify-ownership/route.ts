import { NextRequest } from "next/server";
import { requireUser, errorResponse } from "@/lib/session";
import { envLimit, rateLimit, rateLimitResponse, clientIp } from "@/lib/rate-limit";
import { getOrCreateVerifyCode } from "@/lib/store";
import { verifyOwnership } from "@/lib/ownership";

export const runtime = "nodejs";

/**
 * POST /api/creator/verify-ownership  { url }
 *
 * Checks whether the signed-in creator owns the imported source:
 *   • GitHub → repo owner == their GitHub OAuth login.
 *   • X / Substack / Medium → their per-user code appears in the profile bio.
 * Returns the verdict plus (for bio-code platforms) the code + instructions.
 */
export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit({
      key: `verify:${clientIp(req.headers)}`,
      limit: envLimit("RATE_LIMIT_IMPORT", 10),
      windowSec: 60,
    });
    if (!rl.ok) return rateLimitResponse(rl);

    const user = await requireUser();
    const { url } = (await req.json().catch(() => ({}))) as { url?: string };
    if (!url || typeof url !== "string") return Response.json({ error: "missing_url" }, { status: 400 });

    const verifyCode = await getOrCreateVerifyCode(user.id);
    const result = await verifyOwnership({
      url,
      githubUsername: user.github_username,
      verifyCode,
    });

    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
