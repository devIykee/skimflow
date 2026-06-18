/**
 * Admin analytics queries — metrics KPIs, charts, discovery funnel, and the
 * enriched content/payment listings the admin dashboard reads. Kept separate
 * from store.ts to isolate the heavy aggregates.
 */
import { query, queryOne } from "./db.js";
import { getCounter } from "./store.js";

// ── Metrics (top-bar KPIs) ───────────────────────────────────────────────────
export interface AdminMetrics {
  totalRevenue: string;
  revenue24h: string;
  revenue24hPrev: string;
  platformEarnings: string;
  activeReaders: number;
  activeAgents: number;
  totalCreators: number;
  newCreators24h: number;
  newCreators24hPrev: number;
  publishedPieces: number;
  totalUnlocks: number;
  unlocks24h: number;
  unlocks24hPrev: number;
  pendingPayouts: string;
  hitRate402: number; // percentage 0-100
  // Phase 5 additions
  reserveBalance: string; // accumulated 3% reserve (off-chain ledger sum)
  referrerPaid: string; // total credited to referrers
  pendingSettlement: string; // gross still 'pending' (awaiting on-chain settle)
  failedPayments: number;
  agentRevenue: string; // gross from agent payers
  humanRevenue: string; // gross from human payers
  verifiedPieces: number; // published content with ownership verified
}

export async function getMetrics(): Promise<AdminMetrics> {
  const rev = await queryOne<{
    total_revenue: string;
    platform_earnings: string;
    total_unlocks: string;
    revenue_24h: string;
    revenue_24h_prev: string;
    unlocks_24h: string;
    unlocks_24h_prev: string;
    creator_credited: string;
    reserve_balance: string;
    referrer_paid: string;
    pending_settlement: string;
    failed_payments: string;
    agent_revenue: string;
    human_revenue: string;
  }>(
    `SELECT
       COALESCE(SUM(gross_amount) FILTER (WHERE status='completed'),0)::text AS total_revenue,
       COALESCE(SUM(platform_amount) FILTER (WHERE status='completed'),0)::text AS platform_earnings,
       COUNT(*) FILTER (WHERE status='completed')::text AS total_unlocks,
       COALESCE(SUM(gross_amount) FILTER (WHERE status='completed' AND created_at >= NOW()-INTERVAL '24 hours'),0)::text AS revenue_24h,
       COALESCE(SUM(gross_amount) FILTER (WHERE status='completed' AND created_at >= NOW()-INTERVAL '48 hours' AND created_at < NOW()-INTERVAL '24 hours'),0)::text AS revenue_24h_prev,
       COUNT(*) FILTER (WHERE status='completed' AND created_at >= NOW()-INTERVAL '24 hours')::text AS unlocks_24h,
       COUNT(*) FILTER (WHERE status='completed' AND created_at >= NOW()-INTERVAL '48 hours' AND created_at < NOW()-INTERVAL '24 hours')::text AS unlocks_24h_prev,
       COALESCE(SUM(creator_amount) FILTER (WHERE status='completed'),0)::text AS creator_credited,
       COALESCE(SUM(reserve_amount) FILTER (WHERE status='completed'),0)::text AS reserve_balance,
       COALESCE(SUM(referrer_amount) FILTER (WHERE status='completed'),0)::text AS referrer_paid,
       COALESCE(SUM(gross_amount) FILTER (WHERE status='pending'),0)::text AS pending_settlement,
       COUNT(*) FILTER (WHERE status='failed')::text AS failed_payments,
       COALESCE(SUM(gross_amount) FILTER (WHERE status='completed' AND payer_kind='agent'),0)::text AS agent_revenue,
       COALESCE(SUM(gross_amount) FILTER (WHERE status='completed' AND payer_kind='human'),0)::text AS human_revenue
     FROM payment_ledger`
  );

  const creators = await queryOne<{ total: string; new_24h: string; new_24h_prev: string }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '24 hours')::text AS new_24h,
       COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '48 hours' AND created_at < NOW()-INTERVAL '24 hours')::text AS new_24h_prev
     FROM users`
  );

  const published = await queryOne<{ count: string; verified: string }>(
    `SELECT COUNT(*)::text AS count,
            COUNT(*) FILTER (WHERE ownership_verified)::text AS verified
     FROM content WHERE status='published'`
  );

  const activeReaders = await queryOne<{ count: string }>(
    `SELECT COUNT(DISTINCT payer_id)::text AS count FROM payment_ledger
     WHERE payer_kind='human' AND created_at >= NOW()-INTERVAL '60 minutes'`
  );

  const activeAgents = await queryOne<{ count: string }>(
    `SELECT COUNT(DISTINCT payer_id)::text AS count FROM admin_events
     WHERE event_type IN ('402_HIT','AGENT_UNLOCK') AND created_at >= NOW()-INTERVAL '60 minutes'`
  );

  const funnel = await queryOne<{ hits402: string; payments: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE event_type='402_HIT')::text AS hits402,
       COUNT(*) FILTER (WHERE event_type='AGENT_UNLOCK')::text AS payments
     FROM admin_events`
  );

  const paidOut = await queryOne<{ paid: string }>(
    `SELECT COALESCE(SUM(amount),0)::text AS paid FROM payouts WHERE status <> 'failed'`
  );

  const creatorCredited = Number(rev?.creator_credited ?? 0);
  const pendingPayouts = (creatorCredited - Number(paidOut?.paid ?? 0)).toFixed(6);

  const hits = Number(funnel?.hits402 ?? 0);
  const pays = Number(funnel?.payments ?? 0);
  const totalAgentReq = hits + pays;
  const hitRate402 = totalAgentReq === 0 ? 0 : Math.round((hits / totalAgentReq) * 1000) / 10;

  return {
    totalRevenue: rev?.total_revenue ?? "0",
    revenue24h: rev?.revenue_24h ?? "0",
    revenue24hPrev: rev?.revenue_24h_prev ?? "0",
    platformEarnings: rev?.platform_earnings ?? "0",
    activeReaders: Number(activeReaders?.count ?? 0),
    activeAgents: Number(activeAgents?.count ?? 0),
    totalCreators: Number(creators?.total ?? 0),
    newCreators24h: Number(creators?.new_24h ?? 0),
    newCreators24hPrev: Number(creators?.new_24h_prev ?? 0),
    publishedPieces: Number(published?.count ?? 0),
    totalUnlocks: Number(rev?.total_unlocks ?? 0),
    unlocks24h: Number(rev?.unlocks_24h ?? 0),
    unlocks24hPrev: Number(rev?.unlocks_24h_prev ?? 0),
    pendingPayouts,
    hitRate402,
    reserveBalance: rev?.reserve_balance ?? "0",
    referrerPaid: rev?.referrer_paid ?? "0",
    pendingSettlement: rev?.pending_settlement ?? "0",
    failedPayments: Number(rev?.failed_payments ?? 0),
    agentRevenue: rev?.agent_revenue ?? "0",
    humanRevenue: rev?.human_revenue ?? "0",
    verifiedPieces: Number(published?.verified ?? 0),
  };
}

// ── Charts ───────────────────────────────────────────────────────────────────
const RANGE_DAYS: Record<string, number | null> = { "7d": 7, "30d": 30, "90d": 90, all: null };

export interface RevenuePoint {
  date: string;
  gross: string;
  platform: string;
  creator: string;
  txCount: number;
}

export async function getRevenueOverTime(range: string): Promise<RevenuePoint[]> {
  const days = RANGE_DAYS[range] ?? 7;
  const whereTime = days ? `AND created_at >= NOW()-($1 || ' days')::interval` : "";
  const params = days ? [String(days)] : [];
  const rows = await query<{
    date: string;
    gross: string;
    platform: string;
    creator: string;
    tx_count: string;
  }>(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
            COALESCE(SUM(gross_amount),0)::text AS gross,
            COALESCE(SUM(platform_amount),0)::text AS platform,
            COALESCE(SUM(creator_amount),0)::text AS creator,
            COUNT(*)::text AS tx_count
     FROM payment_ledger
     WHERE status='completed' ${whereTime}
     GROUP BY 1 ORDER BY 1 ASC`,
    params
  );
  return rows.map((r) => ({
    date: r.date,
    gross: r.gross,
    platform: r.platform,
    creator: r.creator,
    txCount: Number(r.tx_count),
  }));
}

export interface ContentRevenue {
  contentId: string;
  title: string;
  slug: string;
  gross: string;
  creator: string;
  platform: string;
}

export async function getRevenueByContent(): Promise<ContentRevenue[]> {
  const rows = await query<{
    content_id: string;
    title: string;
    slug: string;
    gross: string;
    creator: string;
    platform: string;
  }>(
    `SELECT l.content_id, c.title, c.slug,
            SUM(l.gross_amount)::text AS gross,
            SUM(l.creator_amount)::text AS creator,
            SUM(l.platform_amount)::text AS platform
     FROM payment_ledger l JOIN content c ON c.id = l.content_id
     WHERE l.status='completed'
     GROUP BY l.content_id, c.title, c.slug
     ORDER BY SUM(l.gross_amount) DESC
     LIMIT 10`
  );
  return rows.map((r) => ({
    contentId: r.content_id,
    title: r.title,
    slug: r.slug,
    gross: r.gross,
    creator: r.creator,
    platform: r.platform,
  }));
}

// ── Discovery funnel (agents) ────────────────────────────────────────────────
export interface AgentFunnel {
  wellKnownHits: number;
  block0Fetches: number;
  hits402: number;
  payments: number;
}

export async function getAgentFunnel(): Promise<AgentFunnel> {
  const [wk, b0, ev] = await Promise.all([
    getCounter("wellknown_hit"),
    getCounter("block0_fetch"),
    queryOne<{ hits402: string; payments: string }>(
      `SELECT COUNT(*) FILTER (WHERE event_type='402_HIT')::text AS hits402,
              COUNT(*) FILTER (WHERE event_type='AGENT_UNLOCK')::text AS payments
       FROM admin_events`
    ),
  ]);
  return {
    wellKnownHits: wk,
    block0Fetches: b0,
    hits402: Number(ev?.hits402 ?? 0),
    payments: Number(ev?.payments ?? 0),
  };
}

// ── Admin content listing ────────────────────────────────────────────────────
export interface AdminContentRow {
  id: string;
  title: string;
  slug: string;
  content_type: string;
  price_per_block: string;
  status: string;
  creator_handle: string | null;
  creator_name: string | null;
  published_at: Date | null;
  total_earned: string;
}

export function adminListContent(opts: { search?: string; status?: string; limit?: number; offset?: number } = {}): Promise<AdminContentRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.search) {
    params.push(`%${opts.search.toLowerCase()}%`);
    where.push(`(LOWER(c.title) LIKE $${params.length} OR LOWER(c.slug) LIKE $${params.length})`);
  }
  if (opts.status) {
    params.push(opts.status);
    where.push(`c.status = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(Math.min(opts.limit ?? 50, 200), opts.offset ?? 0);
  return query<AdminContentRow>(
    `SELECT c.id, c.title, c.slug, c.content_type, c.price_per_block, c.status,
            c.published_at, u.handle AS creator_handle, u.display_name AS creator_name,
            COALESCE((SELECT SUM(gross_amount) FROM payment_ledger l WHERE l.content_id=c.id AND l.status='completed'),0)::text AS total_earned
     FROM content c JOIN users u ON u.id = c.creator_id
     ${whereSql}
     ORDER BY c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
}

// ── Payments totals (for the ledger explorer footer) ─────────────────────────
export interface PaymentTotals {
  count: number;
  gross: string;
  creator: string;
  platform: string;
  referrer: string;
}

export async function paymentTotals(): Promise<PaymentTotals> {
  const r = await queryOne<{ count: string; gross: string; creator: string; platform: string; referrer: string }>(
    `SELECT COUNT(*)::text AS count,
            COALESCE(SUM(gross_amount),0)::text AS gross,
            COALESCE(SUM(creator_amount),0)::text AS creator,
            COALESCE(SUM(platform_amount),0)::text AS platform,
            COALESCE(SUM(referrer_amount),0)::text AS referrer
     FROM payment_ledger WHERE status='completed'`
  );
  return {
    count: Number(r?.count ?? 0),
    gross: r?.gross ?? "0",
    creator: r?.creator ?? "0",
    platform: r?.platform ?? "0",
    referrer: r?.referrer ?? "0",
  };
}

// ── CSV export: bounded paging (never buffers the full set) ───────────────────
export async function countLedgerForExport(): Promise<number> {
  const r = await queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM payment_ledger`);
  return Number(r?.count ?? 0);
}

export const CSV_HEADER =
  "id,created_at,content_id,creator_id,payer_id,payer_kind,block_index,gross_amount,creator_amount,platform_amount,referrer_amount,referrer_id,tx_hash,status\n";

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Async generator yielding CSV lines, paged so memory stays bounded. */
export async function* ledgerCsvRows(pageSize = 1000): AsyncGenerator<string> {
  yield CSV_HEADER;
  let offset = 0;
  for (;;) {
    const rows = await query<Record<string, unknown>>(
      `SELECT id, created_at, content_id, creator_id, payer_id, payer_kind, block_index,
              gross_amount, creator_amount, platform_amount, referrer_amount, referrer_id, tx_hash, status
       FROM payment_ledger ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      yield [
        r.id, r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        r.content_id, r.creator_id, r.payer_id, r.payer_kind, r.block_index,
        r.gross_amount, r.creator_amount, r.platform_amount, r.referrer_amount,
        r.referrer_id, r.tx_hash, r.status,
      ].map(csvCell).join(",") + "\n";
    }
    offset += rows.length;
    if (rows.length < pageSize) break;
  }
}
