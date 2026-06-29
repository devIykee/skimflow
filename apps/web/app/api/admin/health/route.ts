import { requireAdmin, errorResponse } from "@/lib/session";
import { dbPing } from "@/lib/db";
import { lastCompletedPayment, lastSignup } from "@/lib/store";
import { sseCount } from "@/lib/sse-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function checkGateway(mode: string): Promise<{ status: string; last_checked: string; mode: string }> {
  const now = new Date().toISOString();
  if (mode === "simulate") return { status: "ok", last_checked: now, mode };
  const url = process.env.CIRCLE_GATEWAY_URL;
  if (!url) return { status: "down", last_checked: now, mode };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
    return { status: res.status < 500 ? "ok" : "degraded", last_checked: now, mode };
  } catch {
    return { status: "down", last_checked: now, mode };
  }
}

export async function GET() {
  try {
    await requireAdmin();
    const mode = (process.env.PAYMENTS_MODE ?? "simulate").toLowerCase() === "live" ? "live" : "simulate";
    const hasUpstash = !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

    const [db, gateway, lastPay, lastUser] = await Promise.all([
      dbPing(),
      checkGateway(mode),
      lastCompletedPayment(),
      lastSignup(),
    ]);

    const env_warnings: string[] = [];
    if (mode === "simulate") env_warnings.push("PAYMENTS_MODE=simulate — switch to live before production");
    if (!hasUpstash) env_warnings.push("UPSTASH_REDIS_REST_URL not set — using in-memory rate limiting");
    if (!process.env.ADMIN_EMAIL) env_warnings.push("ADMIN_EMAIL not set — no admin accounts will be auto-promoted");
    if (mode === "live" && !process.env.CIRCLE_WEBHOOK_SECRET)
      env_warnings.push("CIRCLE_WEBHOOK_SECRET not set — webhook signatures cannot be verified");
    if (!process.env.NEXTAUTH_SECRET && !process.env.AUTH_SECRET)
      env_warnings.push("NEXTAUTH_SECRET not set — sessions are insecure");
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL)
      env_warnings.push("Resend not fully configured — transactional emails are disabled");

    return Response.json({
      database: { status: db.ok ? "ok" : "down", latency_ms: db.latencyMs },
      circle_gateway: gateway,
      payments_mode: mode,
      redis: { status: hasUpstash ? "ok" : "unavailable", mode: hasUpstash ? "upstash" : "in-memory" },
      event_stream: { status: "ok", connected_clients: sseCount() },
      last_payment: lastPay
        ? { timestamp: lastPay.created_at, amount: Number(lastPay.gross_amount) }
        : null,
      last_signup: lastUser ? { timestamp: lastUser.created_at } : null,
      env_warnings,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
