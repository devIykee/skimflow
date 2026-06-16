import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import type { SettlementReceipt, RevenueSplit } from "@linepay/sdk";

export interface Creator {
  id: string;
  handle: string;
  display_name: string;
  wallet: string;
  verified: number;
  created_at: number;
}

export type ContentKind =
  | "article"
  | "novel_chapter"
  | "agent-skill"
  | "prompt-template"
  | "knowledge-base";

export interface Content {
  id: string;
  creator_id: string;
  kind: ContentKind;
  title: string;
  summary: string;
  tags: string;
  body: string;
  line_count: number;
  price_per_line: string;
  free_lines: number;
  series: string | null;
  chapter_no: number | null;
  created_at: number;
}

export interface Payment {
  id: string;
  content_id: string;
  creator_id: string;
  payer: string;
  payer_kind: "agent" | "human";
  line_start: number;
  line_end: number;
  line_count: number;
  amount: string;
  creator_amount: string;
  platform_amount: string;
  referrer_amount: string;
  tx_hash: string;
  batch_id: string | null;
  content_hash: string;
  simulated: number;
  created_at: number;
}

// ── Creators ────────────────────────────────────────────────────────────────
export function upsertCreator(c: Omit<Creator, "created_at"> & { created_at?: number }): Creator {
  const created_at = c.created_at ?? Date.now();
  db()
    .prepare(
      `INSERT INTO creators (id, handle, display_name, wallet, verified, created_at)
       VALUES (@id, @handle, @display_name, @wallet, @verified, @created_at)
       ON CONFLICT(handle) DO UPDATE SET
         display_name=excluded.display_name, wallet=excluded.wallet, verified=excluded.verified`
    )
    .run({ ...c, created_at });
  return getCreatorByHandle(c.handle)!;
}

export function getCreatorByHandle(handle: string): Creator | undefined {
  return db().prepare(`SELECT * FROM creators WHERE handle = ?`).get(handle) as Creator | undefined;
}
export function getCreator(id: string): Creator | undefined {
  return db().prepare(`SELECT * FROM creators WHERE id = ?`).get(id) as Creator | undefined;
}
export function listCreators(): Creator[] {
  return db().prepare(`SELECT * FROM creators ORDER BY created_at`).all() as Creator[];
}

// ── Content ─────────────────────────────────────────────────────────────────
export function createContent(c: Omit<Content, "id" | "created_at"> & { id?: string }): Content {
  const id = c.id ?? `c_${randomUUID().slice(0, 8)}`;
  const created_at = Date.now();
  db()
    .prepare(
      `INSERT OR REPLACE INTO content
        (id, creator_id, kind, title, summary, tags, body, line_count, price_per_line, free_lines, series, chapter_no, created_at)
       VALUES (@id,@creator_id,@kind,@title,@summary,@tags,@body,@line_count,@price_per_line,@free_lines,@series,@chapter_no,@created_at)`
    )
    .run({ ...c, id, created_at });
  return getContent(id)!;
}

export function getContent(id: string): Content | undefined {
  return db().prepare(`SELECT * FROM content WHERE id = ?`).get(id) as Content | undefined;
}

export function listContent(): Content[] {
  return db().prepare(`SELECT * FROM content ORDER BY created_at DESC`).all() as Content[];
}

/** Lightweight catalog the discovery tool searches over (no body). */
export function catalog(): Array<
  Pick<Content, "id" | "kind" | "title" | "summary" | "tags" | "line_count" | "price_per_line" | "series" | "chapter_no"> & {
    creator_handle: string;
    verified: boolean;
  }
> {
  const rows = db()
    .prepare(
      `SELECT ct.id, ct.kind, ct.title, ct.summary, ct.tags, ct.line_count, ct.price_per_line,
              ct.series, ct.chapter_no, cr.handle as creator_handle, cr.verified as verified
       FROM content ct JOIN creators cr ON cr.id = ct.creator_id
       ORDER BY ct.created_at DESC`
    )
    .all() as any[];
  return rows.map((r) => ({ ...r, verified: !!r.verified }));
}

// ── Payments / earnings ───────────────────────────────────────────────────────
export function recordPayment(args: {
  content: Content;
  payer: string;
  payerKind: "agent" | "human";
  lineStart: number;
  lineEnd: number;
  lineCount: number;
  split: RevenueSplit;
  receipt: SettlementReceipt;
  contentHash: string;
}): Payment {
  const id = `p_${randomUUID().slice(0, 8)}`;
  const total =
    BigInt(args.split.creator.amount) +
    BigInt(args.split.platform.amount) +
    BigInt(args.split.referrer.amount);
  const row: Payment = {
    id,
    content_id: args.content.id,
    creator_id: args.content.creator_id,
    payer: args.payer,
    payer_kind: args.payerKind,
    line_start: args.lineStart,
    line_end: args.lineEnd,
    line_count: args.lineCount,
    amount: total.toString(),
    creator_amount: args.split.creator.amount,
    platform_amount: args.split.platform.amount,
    referrer_amount: args.split.referrer.amount,
    tx_hash: args.receipt.txHash,
    batch_id: args.receipt.batchId ?? null,
    content_hash: args.contentHash,
    simulated: args.receipt.simulated ? 1 : 0,
    created_at: Date.now(),
  };
  db()
    .prepare(
      `INSERT INTO payments
        (id,content_id,creator_id,payer,payer_kind,line_start,line_end,line_count,amount,
         creator_amount,platform_amount,referrer_amount,tx_hash,batch_id,content_hash,simulated,created_at)
       VALUES (@id,@content_id,@creator_id,@payer,@payer_kind,@line_start,@line_end,@line_count,@amount,
         @creator_amount,@platform_amount,@referrer_amount,@tx_hash,@batch_id,@content_hash,@simulated,@created_at)`
    )
    .run(row);
  return row;
}

/** Idempotency guard — has this on-chain tx already unlocked something? */
export function paymentExistsByTx(txHash: string): boolean {
  const row = db().prepare(`SELECT 1 FROM payments WHERE tx_hash = ? LIMIT 1`).get(txHash);
  return !!row;
}

export function recentPayments(limit = 50): Array<Payment & { title: string; creator_handle: string }> {
  return db()
    .prepare(
      `SELECT p.*, ct.title as title, cr.handle as creator_handle
       FROM payments p JOIN content ct ON ct.id = p.content_id JOIN creators cr ON cr.id = p.creator_id
       ORDER BY p.created_at DESC LIMIT ?`
    )
    .all(limit) as any[];
}

export function creatorEarnings(creatorId: string) {
  const agg = db()
    .prepare(
      `SELECT COUNT(*) as payments,
              COALESCE(SUM(CAST(creator_amount AS INTEGER)),0) as earned,
              COALESCE(SUM(line_count),0) as lines_sold
       FROM payments WHERE creator_id = ?`
    )
    .get(creatorId) as { payments: number; earned: number; lines_sold: number };
  const history = db()
    .prepare(
      `SELECT p.*, ct.title as title FROM payments p JOIN content ct ON ct.id = p.content_id
       WHERE p.creator_id = ? ORDER BY p.created_at DESC LIMIT 100`
    )
    .all(creatorId) as any[];
  return { ...agg, earned: String(agg.earned), history };
}
