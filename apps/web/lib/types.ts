/**
 * Row types for the Postgres schema (db/migrations/0001_init.sql).
 *
 * `pg` returns NUMERIC(18,6) columns as strings (lossless) and TIMESTAMPTZ as
 * JS Date objects — reflected below. Amounts are decimal USDC strings; convert
 * with lib/money.ts for arithmetic.
 */
export type UserRole = "creator" | "admin";
/** Which wallet the active payout (`wallet_address`) points at. */
export type WalletSource = "embedded" | "external";
export type ContentType = "article" | "agent-skills" | "picture" | "book";
export type ContentStatus = "draft" | "published" | "suspended";
export type PayerKind = "human" | "agent";
export type LedgerStatus = "pending" | "completed" | "failed";
export type PayoutStatus = "initiated" | "confirmed" | "failed";
export type ExportStatus = "pending" | "processing" | "complete" | "failed";
export type ReportType = "broken_link" | "content_report";
export type ReportStatus = "open" | "reviewed" | "resolved" | "dismissed";

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  provider: string | null;
  wallet_address: string | null;
  /** Circle User-Controlled wallet id + EVM address (null for admins / not-yet-provisioned). */
  embedded_wallet_id: string | null;
  embedded_wallet_address: string | null;
  /** Whether `wallet_address` is the embedded wallet or an externally-connected one. */
  wallet_source: WalletSource;
  role: UserRole;
  handle: string | null;
  display_name: string | null;
  bio: string | null;
  verified: boolean;
  github_username: string | null;
  verify_code: string | null;
  suspended: boolean;
  last_active_at: Date | null;
  created_at: Date;
}

export interface Content {
  id: string;
  creator_id: string;
  slug: string;
  title: string;
  summary: string;
  tags: string;
  content_type: ContentType;
  body: string;
  price_per_block: string; // decimal USDC (for books: price per page)
  /** Book cover image (book content_type only; migration 0011). */
  cover_image_url: string | null;
  gateway_address: string | null;
  status: ContentStatus;
  suspended_reason: string | null;
  block_count: number;
  view_count: number;
  source_url: string | null;
  source_platform: string | null;
  ownership_verified: boolean;
  verified_via: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Chunk {
  id: string;
  content_id: string;
  block_index: number;
  text: string;
  is_free: boolean;
  /** Picture Skim-Flow only (migration 0009): the (normalized) image link and
   * optional caption. null for text/agent-skills chunks. */
  image_url: string | null;
  caption: string | null;
  /** Book pages only (migration 0011): the chapter this page belongs to. null
   * for article/agent-skills/picture chunks. */
  chapter_id: string | null;
}

/** A chapter groups ordered pages (chunks) within a book (migration 0011). */
export interface Chapter {
  id: string;
  content_id: string;
  chapter_index: number;
  title: string;
  created_at: Date;
}

export interface LedgerRow {
  id: string;
  content_id: string | null;
  creator_id: string | null;
  payer_id: string | null;
  payer_kind: PayerKind;
  block_index: number | null;
  gross_amount: string;
  creator_amount: string;
  platform_amount: string;
  referrer_amount: string;
  referrer_id: string | null;
  reserve_amount: string;
  pay_session_id: string | null;
  payment_token: string | null;
  tx_hash: string | null;
  status: LedgerStatus;
  /** Settlement-recovery fields (migration 0007) for retrying a stuck silent payment. */
  attestation: string | null;
  burn_signature: string | null;
  mint_tx: string | null;
  /** True when the reader was shown the chunk before payment confirmed (§3, migration 0010). */
  optimistic: boolean;
  created_at: Date;
  completed_at: Date | null;
}

/** Session-key authorization for silent chunk payments (see migration 0003). */
export type PaySessionStatus = "active" | "revoked" | "expired";
export interface PaySessionRow {
  id: string;
  main_wallet: string;
  session_address: string;
  cap: string;
  spent: string;
  status: PaySessionStatus;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
}

/** A ledger row joined with its content + creator for human-readable admin views. */
export interface LedgerRowEnriched extends LedgerRow {
  content_title: string | null;
  content_slug: string | null;
  creator_name: string | null;
  creator_handle: string | null;
}

export interface Payout {
  id: string;
  creator_id: string;
  amount: string;
  wallet_address: string;
  tx_hash: string | null;
  status: PayoutStatus;
  created_at: Date;
  confirmed_at: Date | null;
}

export type AdminEventType =
  | "UNLOCK"
  | "AGENT_UNLOCK"
  | "PUBLISH"
  | "SIGNUP"
  | "PAYOUT"
  | "402_HIT"
  | "WEBHOOK_REJECTED"
  | "IMPERSONATE"
  | "REPORT"
  | "ADMIN_EMAIL";

export interface AdminEvent {
  id: string;
  event_type: AdminEventType;
  actor_id: string | null;
  payer_id: string | null;
  content_id: string | null;
  block_index: number | null;
  amount_gross: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface AgentSession {
  session_key: string;
  ip: string | null;
  user_agent: string | null;
  label: string | null;
  notes: string | null;
  trusted: boolean;
  blocked: boolean;
  first_seen: Date;
  last_seen: Date;
  total_402_hits: number;
  total_unlocks: number;
  total_spent_usdc: string;
}

export interface Report {
  id: string;
  report_type: ReportType;
  reason: string | null;
  detail: string | null;
  content_id: string | null;
  block_index: number | null;
  creator_id: string | null;
  reporter_id: string | null;
  reporter_label: string | null;
  amount_paid: string | null;
  status: ReportStatus;
  created_at: Date;
  updated_at: Date;
}

/** A report joined with its content + creator for the admin inbox. */
export interface ReportEnriched extends Report {
  content_title: string | null;
  content_slug: string | null;
  creator_handle: string | null;
}

export interface ExportJob {
  id: string;
  admin_id: string;
  filters: Record<string, unknown> | null;
  status: ExportStatus;
  row_count: number | null;
  file_path: string | null;
  created_at: Date;
  completed_at: Date | null;
}
