import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  confirmPayout,
  failLedgerByToken,
  finalizeLedgerByToken,
  flagAgentSessionByPayer,
  getLedgerByToken,
  recordAdminEvent,
} from "@/lib/store";
import { sendPayoutNotification } from "@/lib/email";
import { getUserById } from "@/lib/store";
import { formatUsdc } from "@/lib/money";
import { envLimit, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

const SIGNATURE_HEADERS = ["x-circle-signature", "circle-signature", "x-signature"];

function verifySignature(raw: string, headers: Headers, secret: string): boolean {
  const provided = SIGNATURE_HEADERS.map((h) => headers.get(h)).find(Boolean);
  if (!provided) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  // Accept "sha256=<hex>" or bare hex.
  const sig = provided.startsWith("sha256=") ? provided.slice(7) : provided;
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

interface CircleEvent {
  type?: string;
  paymentId?: string;
  payoutId?: string;
  txHash?: string;
  transactionHash?: string;
  amount?: string;
  currency?: string;
}

/**
 * Circle webhook — the AUTHORITATIVE source of payment confirmation. We never
 * trust X-Payment-Token alone; ledger rows are only finalized here.
 *
 *  - payment.confirmed  → ledger 'completed'
 *  - payment.failed     → ledger 'failed'   + flag agent session
 *  - transfer.confirmed → payout 'confirmed' + payout email
 *
 * Live mode requires a valid HMAC signature (CIRCLE_WEBHOOK_SECRET); a bad
 * signature returns 403 and logs WEBHOOK_REJECTED. Simulate mode accepts an
 * unsigned test payload so the flow can be exercised locally.
 */
export async function POST(req: NextRequest) {
  // Rate limit (global) before anything else.
  const rl = await rateLimit({ key: "webhook:circle", limit: envLimit("RATE_LIMIT_WEBHOOK", 200), windowSec: 60 });
  if (!rl.ok) return rateLimitResponse(rl);

  const raw = await req.text();
  const simulate = (process.env.PAYMENTS_MODE ?? "simulate").toLowerCase() !== "live";

  // Signature verification (live mode).
  if (!simulate) {
    const secret = process.env.CIRCLE_WEBHOOK_SECRET;
    if (!secret || !verifySignature(raw, req.headers, secret)) {
      await recordAdminEvent({
        eventType: "WEBHOOK_REJECTED",
        metadata: { reason: secret ? "bad_signature" : "no_secret_configured", ip: req.headers.get("x-forwarded-for") },
      });
      return Response.json({ error: "invalid_signature" }, { status: 403 });
    }
  }

  let event: CircleEvent;
  try {
    event = JSON.parse(raw) as CircleEvent;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const txHash = event.txHash ?? event.transactionHash ?? null;

  switch (event.type) {
    case "payment.confirmed": {
      if (!event.paymentId) return Response.json({ error: "missing_paymentId" }, { status: 400 });
      const row = await finalizeLedgerByToken(event.paymentId, txHash);
      return Response.json({ ok: true, finalized: !!row });
    }

    case "payment.failed": {
      if (!event.paymentId) return Response.json({ error: "missing_paymentId" }, { status: 400 });
      const existing = await getLedgerByToken(event.paymentId);
      const row = await failLedgerByToken(event.paymentId);
      if (existing?.payer_id?.startsWith("agent:")) {
        await flagAgentSessionByPayer(existing.payer_id, `payment failed for token ${event.paymentId}`);
      }
      return Response.json({ ok: true, failed: !!row });
    }

    case "transfer.confirmed": {
      if (!event.payoutId) return Response.json({ error: "missing_payoutId" }, { status: 400 });
      const payout = await confirmPayout(event.payoutId, txHash ?? event.paymentId ?? "");
      if (payout) {
        const creator = await getUserById(payout.creator_id);
        await recordAdminEvent({
          eventType: "PAYOUT",
          actorId: payout.creator_id,
          amountGross: payout.amount,
          metadata: { txHash: payout.tx_hash, status: "confirmed" },
        });
        if (creator?.email && payout.tx_hash) {
          void sendPayoutNotification({
            creatorName: creator.display_name ?? creator.name ?? "Creator",
            creatorEmail: creator.email,
            amount: formatUsdc(payout.amount),
            txHash: payout.tx_hash,
            walletAddress: payout.wallet_address,
          });
        }
      }
      return Response.json({ ok: true, confirmed: !!payout });
    }

    default:
      return Response.json({ ok: true, ignored: event.type ?? "unknown" });
  }
}
