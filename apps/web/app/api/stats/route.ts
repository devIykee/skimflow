import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { formatUsdc } from "@linepay/sdk";

/** Platform-wide traction stats for the hackathon (volume, payments, splits). */
export async function GET() {
  const d = db();
  const totals = d.prepare(
    `SELECT COUNT(*) as payments,
            COALESCE(SUM(CAST(amount AS INTEGER)),0) as volume,
            COALESCE(SUM(CAST(creator_amount AS INTEGER)),0) as to_creators,
            COALESCE(SUM(line_count),0) as lines_sold,
            SUM(CASE WHEN payer_kind='human' THEN 1 ELSE 0 END) as human_payments,
            SUM(CASE WHEN payer_kind='agent' THEN 1 ELSE 0 END) as agent_payments
     FROM payments`
  ).get() as any;
  const creators = (d.prepare(`SELECT COUNT(*) as n FROM creators`).get() as any).n;
  const content = (d.prepare(`SELECT COUNT(*) as n FROM content`).get() as any).n;

  return NextResponse.json({
    payments: totals.payments,
    humanPayments: totals.human_payments,
    agentPayments: totals.agent_payments,
    linesSold: totals.lines_sold,
    creators,
    content,
    volumeBaseUnits: String(totals.volume),
    volumeDisplay: formatUsdc(totals.volume),
    toCreatorsDisplay: formatUsdc(totals.to_creators),
  });
}
