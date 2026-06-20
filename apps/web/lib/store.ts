/**
 * Postgres data-access layer. All SQL lives here; routes call typed functions.
 * Replaces the legacy SQLite line-based store. Amounts are decimal USDC strings.
 */
import { query, queryOne, tx } from "./db.js";
import type {
  AdminEvent,
  AdminEventType,
  AgentSession,
  Chunk,
  Content,
  ContentStatus,
  ContentType,
  ExportJob,
  LedgerRow,
  LedgerRowEnriched,
  LedgerStatus,
  PayerKind,
  PaySessionRow,
  Payout,
  User,
  UserRole,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Users (creators / admins)
// ─────────────────────────────────────────────────────────────────────────────

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24) || "creator";
}

/** Short random hex suffix to keep generated handles unique. */
function randomSuffix(): string {
  // Deterministic-enough uniqueness without Math.random (avoids sandbox bans):
  // derive from high-res time. Collisions are caught by the unique index.
  return process.hrtime.bigint().toString(36).slice(-4);
}

export interface OAuthProfile {
  email: string;
  name?: string | null;
  avatar?: string | null;
  provider?: string | null;
  /** GitHub login (username) — used to verify ownership of GitHub imports. */
  githubUsername?: string | null;
}

/**
 * Create-or-update a user from an OAuth login. Promotes to 'admin' when the
 * email matches ADMIN_EMAIL (and never downgrades an existing admin). Generates
 * a unique handle on first insert; keeps it stable afterwards.
 * Returns { user, isNew } so the caller can fire the SIGNUP admin event.
 */
export async function upsertUserFromOAuth(
  profile: OAuthProfile
): Promise<{ user: User; isNew: boolean }> {
  const email = profile.email.trim().toLowerCase();
  const isAdmin = !!process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.trim().toLowerCase();
  const base = slugify(email.split("@")[0] ?? profile.name ?? "creator");
  const candidateHandle = `${base}_${randomSuffix()}`;
  const displayName = profile.name ?? base;

  const row = await queryOne<User & { xmax: string }>(
    `INSERT INTO users (email, name, avatar, provider, role, handle, display_name, github_username, last_active_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $9, NOW())
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       avatar = EXCLUDED.avatar,
       provider = EXCLUDED.provider,
       display_name = COALESCE(users.display_name, EXCLUDED.display_name),
       github_username = COALESCE(EXCLUDED.github_username, users.github_username),
       last_active_at = NOW(),
       role = CASE WHEN $8 OR users.role = 'admin' THEN 'admin' ELSE users.role END
     RETURNING *, (xmax = 0) AS xmax`,
    [
      email,
      profile.name ?? null,
      profile.avatar ?? null,
      profile.provider ?? null,
      isAdmin ? "admin" : "creator",
      candidateHandle,
      displayName,
      isAdmin,
      profile.githubUsername ?? null,
    ]
  );
  if (!row) throw new Error("user upsert failed");
  // xmax = 0 on a freshly inserted row (Postgres trick to detect insert vs update).
  const isNew = String((row as unknown as { xmax: boolean }).xmax) === "true";
  const { xmax: _ignore, ...user } = row as User & { xmax: unknown };
  return { user: user as User, isNew };
}

/**
 * Return the user's bio-verification code, generating + persisting one on first
 * use. The code is what creators paste into their X/Substack/Medium bio.
 */
export async function getOrCreateVerifyCode(userId: string): Promise<string> {
  const existing = await queryOne<{ verify_code: string | null }>(
    `SELECT verify_code FROM users WHERE id = $1`,
    [userId]
  );
  if (existing?.verify_code) return existing.verify_code;
  const code = `linepay-verify-${process.hrtime.bigint().toString(36).slice(-10)}`;
  const row = await queryOne<{ verify_code: string }>(
    `UPDATE users SET verify_code = COALESCE(verify_code, $2) WHERE id = $1 RETURNING verify_code`,
    [userId, code]
  );
  return row?.verify_code ?? code;
}

export function getUserById(id: string): Promise<User | undefined> {
  return queryOne<User>(`SELECT * FROM users WHERE id = $1`, [id]);
}
export function getUserByEmail(email: string): Promise<User | undefined> {
  return queryOne<User>(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
}
export function getUserByHandle(handle: string): Promise<User | undefined> {
  return queryOne<User>(`SELECT * FROM users WHERE handle = $1`, [handle]);
}
export function getUsersByIds(ids: string[]): Promise<User[]> {
  if (!ids.length) return Promise.resolve([]);
  return query<User>(`SELECT * FROM users WHERE id = ANY($1::uuid[])`, [ids]);
}

export function touchUser(id: string): Promise<unknown> {
  return query(`UPDATE users SET last_active_at = NOW() WHERE id = $1`, [id]);
}

/** Normalize a user-chosen handle to the stored slug form (≤24 chars). */
export function normalizeHandle(raw: string): string {
  return slugify(raw);
}

/** True if `handle` is already used by a DIFFERENT user. */
export async function isHandleTaken(handle: string, exceptUserId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM users WHERE handle = $1 AND id <> $2 LIMIT 1`,
    [handle, exceptUserId]
  );
  return !!row;
}

export interface ProfileUpdate {
  displayName: string;
  handle: string;
  bio: string;
}

/**
 * Update a creator's editable profile fields. Handle uniqueness is enforced by
 * the unique index; on a race we surface a typed conflict instead of a 500.
 */
export async function updateProfile(
  userId: string,
  p: ProfileUpdate
): Promise<{ ok: true; user: User } | { ok: false; reason: "handle_taken" }> {
  try {
    const user = await queryOne<User>(
      `UPDATE users SET display_name = $2, handle = $3, bio = $4 WHERE id = $1 RETURNING *`,
      [userId, p.displayName, p.handle, p.bio]
    );
    if (!user) throw new Error("profile update affected no row");
    return { ok: true, user };
  } catch (e) {
    // 23505 = unique_violation (handle collided with another user).
    if ((e as { code?: string })?.code === "23505") return { ok: false, reason: "handle_taken" };
    throw e;
  }
}

/**
 * Store a validated (EIP-55) external wallet as the active payout. Caller must
 * validate first. Marks the payout source 'external' (the user explicitly
 * connected their own wallet, overriding any embedded default).
 */
export function setUserWallet(id: string, wallet: string): Promise<User | undefined> {
  return queryOne<User>(
    `UPDATE users SET wallet_address = $2, wallet_source = 'external' WHERE id = $1 RETURNING *`,
    [id, wallet]
  );
}

/**
 * Persist a freshly-provisioned embedded (Circle User-Controlled) wallet. If the
 * user has never connected an external wallet, the embedded wallet also becomes
 * the active payout — so revenue routes there with zero copy/paste (default
 * routing). An existing external payout is left untouched.
 */
export function setEmbeddedWallet(
  id: string,
  walletId: string,
  address: string
): Promise<User | undefined> {
  return queryOne<User>(
    `UPDATE users
       SET embedded_wallet_id = $2,
           embedded_wallet_address = $3,
           wallet_address = CASE WHEN wallet_address IS NULL THEN $3 ELSE wallet_address END,
           wallet_source  = CASE WHEN wallet_address IS NULL THEN 'embedded' ELSE wallet_source END
     WHERE id = $1 RETURNING *`,
    [id, walletId, address]
  );
}

/**
 * Switch which wallet receives payouts. Points `wallet_address` at the embedded
 * or the stored external address. Returns undefined if the requested wallet
 * isn't set yet (caller surfaces a friendly error).
 */
export async function setPayoutSource(
  id: string,
  source: "embedded" | "external",
  externalAddress?: string
): Promise<User | undefined> {
  if (source === "embedded") {
    return queryOne<User>(
      `UPDATE users
         SET wallet_address = embedded_wallet_address, wallet_source = 'embedded'
       WHERE id = $1 AND embedded_wallet_address IS NOT NULL RETURNING *`,
      [id]
    );
  }
  if (!externalAddress) return undefined;
  return queryOne<User>(
    `UPDATE users SET wallet_address = $2, wallet_source = 'external' WHERE id = $1 RETURNING *`,
    [id, externalAddress]
  );
}

export function setUserRole(id: string, role: UserRole): Promise<User | undefined> {
  return queryOne<User>(`UPDATE users SET role = $2 WHERE id = $1 RETURNING *`, [id, role]);
}

export function setUserSuspended(id: string, suspended: boolean): Promise<User | undefined> {
  return queryOne<User>(
    `UPDATE users SET suspended = $2 WHERE id = $1 RETURNING *`,
    [id, suspended]
  );
}

export interface UserListFilters {
  search?: string;
  role?: UserRole;
  walletLinked?: boolean;
  sort?: "joined" | "earned" | "content";
  limit?: number;
  offset?: number;
}

export interface UserListRow extends User {
  content_count: number;
  total_earned: string;
}

export async function listUsers(f: UserListFilters = {}): Promise<{ rows: UserListRow[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.search) {
    params.push(`%${f.search.toLowerCase()}%`);
    where.push(`(LOWER(u.name) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length} OR LOWER(u.handle) LIKE $${params.length})`);
  }
  if (f.role) {
    params.push(f.role);
    where.push(`u.role = $${params.length}`);
  }
  if (f.walletLinked !== undefined) {
    where.push(f.walletLinked ? `u.wallet_address IS NOT NULL` : `u.wallet_address IS NULL`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order =
    f.sort === "earned"
      ? `total_earned DESC`
      : f.sort === "content"
        ? `content_count DESC`
        : `u.created_at DESC`;

  const limit = Math.min(f.limit ?? 25, 100);
  const offset = f.offset ?? 0;
  params.push(limit, offset);

  const rows = await query<UserListRow>(
    `SELECT u.*,
        (SELECT COUNT(*) FROM content c WHERE c.creator_id = u.id)::int AS content_count,
        COALESCE((SELECT SUM(creator_amount) FROM payment_ledger l WHERE l.creator_id = u.id AND l.status='completed'), 0)::text AS total_earned
     FROM users u
     ${whereSql}
     ORDER BY ${order}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const totalRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM users u ${whereSql}`,
    params.slice(0, params.length - 2)
  );
  return { rows, total: Number(totalRow?.count ?? 0) };
}

export interface WalletListRow {
  id: string;
  email: string;
  display_name: string | null;
  handle: string | null;
  role: UserRole;
  embedded_wallet_address: string | null;
  wallet_address: string | null;
  wallet_source: string;
  created_at: Date;
}

/**
 * Users + their wallet addresses for the admin Wallets table. `sort` controls
 * row order; on-chain USDC/gas balances are fetched in the route (not here).
 * `balance_asc` is handled in the route after balances are read.
 */
export function listWalletUsers(opts: {
  search?: string;
  sort?: "newest" | "oldest" | "earned";
  limit?: number;
  offset?: number;
} = {}): Promise<WalletListRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.search) {
    params.push(`%${opts.search.toLowerCase()}%`);
    where.push(
      `(LOWER(email) LIKE $${params.length} OR LOWER(handle) LIKE $${params.length} OR LOWER(display_name) LIKE $${params.length} OR LOWER(embedded_wallet_address) LIKE $${params.length} OR LOWER(wallet_address) LIKE $${params.length})`
    );
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order = opts.sort === "oldest" ? `created_at ASC` : `created_at DESC`;
  params.push(Math.min(opts.limit ?? 200, 500), opts.offset ?? 0);
  return query<WalletListRow>(
    `SELECT id, email, display_name, handle, role,
            embedded_wallet_address, wallet_address, wallet_source, created_at
     FROM users
     ${whereSql}
     ORDER BY ${order}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Content + chunks
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateContentInput {
  creatorId: string;
  slug: string;
  title: string;
  summary?: string;
  tags?: string;
  contentType: ContentType;
  body: string;
  pricePerBlock: string; // decimal USDC
  gatewayAddress?: string | null;
  /** Chunks to store, in order. */
  chunks: Array<{ text: string; isFree: boolean }>;
  /** block_index of the first chunk. Articles use 0 (chunk 0 is the free
   * preview); agent-skills use 1 (block 0 is the generated onboarding). */
  firstBlockIndex?: number;
  status?: ContentStatus;
  /** Import provenance + ownership verification (Phase 5). */
  sourceUrl?: string | null;
  sourcePlatform?: string | null;
  ownershipVerified?: boolean;
  verifiedVia?: string | null;
}

/** Create content + its chunks atomically. */
export async function createContent(input: CreateContentInput): Promise<Content> {
  return tx(async (client) => {
    const res = await client.query<Content>(
      `INSERT INTO content
         (creator_id, slug, title, summary, tags, content_type, body, price_per_block,
          gateway_address, status, block_count, published_at,
          source_url, source_platform, ownership_verified, verified_via)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        input.creatorId,
        input.slug,
        input.title,
        input.summary ?? "",
        input.tags ?? "",
        input.contentType,
        input.body,
        input.pricePerBlock,
        input.gatewayAddress ?? null,
        input.status ?? "draft",
        input.chunks.filter((c) => !c.isFree).length,
        input.status === "published" ? new Date() : null,
        input.sourceUrl ?? null,
        input.sourcePlatform ?? null,
        input.ownershipVerified ?? false,
        input.verifiedVia ?? null,
      ]
    );
    const content = res.rows[0];
    const base = input.firstBlockIndex ?? 0;
    for (let i = 0; i < input.chunks.length; i++) {
      const c = input.chunks[i];
      await client.query(
        `INSERT INTO chunks (content_id, block_index, text, is_free) VALUES ($1,$2,$3,$4)`,
        [content.id, base + i, c.text, c.isFree]
      );
    }
    return content;
  });
}

export function getContentBySlug(slug: string): Promise<Content | undefined> {
  return queryOne<Content>(`SELECT * FROM content WHERE slug = $1`, [slug]);
}
export function getContentById(id: string): Promise<Content | undefined> {
  return queryOne<Content>(`SELECT * FROM content WHERE id = $1`, [id]);
}

export function getChunks(contentId: string): Promise<Chunk[]> {
  return query<Chunk>(
    `SELECT * FROM chunks WHERE content_id = $1 ORDER BY block_index ASC`,
    [contentId]
  );
}
export function getChunk(contentId: string, blockIndex: number): Promise<Chunk | undefined> {
  return queryOne<Chunk>(
    `SELECT * FROM chunks WHERE content_id = $1 AND block_index = $2`,
    [contentId, blockIndex]
  );
}

export interface ContentWithCreator extends Content {
  creator_handle: string | null;
  creator_name: string | null;
  creator_avatar: string | null;
  creator_verified: boolean;
}

export function getContentWithCreator(slug: string): Promise<ContentWithCreator | undefined> {
  return queryOne<ContentWithCreator>(
    `SELECT c.*, u.handle AS creator_handle, u.display_name AS creator_name,
            u.avatar AS creator_avatar, u.verified AS creator_verified
     FROM content c JOIN users u ON u.id = c.creator_id
     WHERE c.slug = $1`,
    [slug]
  );
}

export function listContentByCreator(creatorId: string): Promise<Content[]> {
  return query<Content>(
    `SELECT * FROM content WHERE creator_id = $1 ORDER BY created_at DESC`,
    [creatorId]
  );
}

export interface MarketplaceFilters {
  contentType?: ContentType;
  /** Content types to exclude (e.g. exclude 'x-post' from the All feed). */
  excludeTypes?: ContentType[];
  minPrice?: string;
  maxPrice?: string;
  sort?: "newest" | "popular";
  limit?: number;
  offset?: number;
}

export function listPublished(f: MarketplaceFilters = {}): Promise<ContentWithCreator[]> {
  const where: string[] = [`c.status = 'published'`];
  const params: unknown[] = [];
  if (f.contentType) {
    params.push(f.contentType);
    where.push(`c.content_type = $${params.length}`);
  } else if (f.excludeTypes && f.excludeTypes.length) {
    const placeholders = f.excludeTypes.map((t) => {
      params.push(t);
      return `$${params.length}`;
    });
    where.push(`c.content_type NOT IN (${placeholders.join(",")})`);
  }
  if (f.minPrice) {
    params.push(f.minPrice);
    where.push(`c.price_per_block >= $${params.length}`);
  }
  if (f.maxPrice) {
    params.push(f.maxPrice);
    where.push(`c.price_per_block <= $${params.length}`);
  }
  const order = f.sort === "popular" ? `c.view_count DESC` : `c.published_at DESC NULLS LAST`;
  params.push(Math.min(f.limit ?? 30, 100), f.offset ?? 0);
  return query<ContentWithCreator>(
    `SELECT c.*, u.handle AS creator_handle, u.display_name AS creator_name,
            u.avatar AS creator_avatar, u.verified AS creator_verified
     FROM content c JOIN users u ON u.id = c.creator_id
     WHERE ${where.join(" AND ")}
     ORDER BY ${order}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
}

export interface SearchResult {
  id: string;
  slug: string;
  title: string;
  summary: string;
  content_type: ContentType;
  price_per_block: string;
  creator_handle: string | null;
  creator_name: string | null;
  rank: number;
  excerpt: string;
}

/** Ranked full-text search over published content. Uses websearch syntax. */
export function searchContent(q: string, limit = 30, offset = 0): Promise<SearchResult[]> {
  return query<SearchResult>(
    `SELECT c.id, c.slug, c.title, c.summary, c.content_type, c.price_per_block,
            u.handle AS creator_handle, u.display_name AS creator_name,
            ts_rank(c.search_tsv, websearch_to_tsquery('english', $1)) AS rank,
            ts_headline('english', COALESCE(NULLIF(c.summary,''), c.title),
              websearch_to_tsquery('english', $1),
              'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=24, MinWords=6') AS excerpt
     FROM content c JOIN users u ON u.id = c.creator_id
     WHERE c.status = 'published' AND c.search_tsv @@ websearch_to_tsquery('english', $1)
     ORDER BY rank DESC
     LIMIT $2 OFFSET $3`,
    [q, Math.min(limit, 100), offset]
  );
}

export function publishContent(id: string): Promise<Content | undefined> {
  return queryOne<Content>(
    `UPDATE content SET status='published', published_at=COALESCE(published_at, NOW()), updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [id]
  );
}
export function unpublishContent(id: string): Promise<Content | undefined> {
  return queryOne<Content>(
    `UPDATE content SET status='draft', updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id]
  );
}
export function suspendContent(id: string, reason: string): Promise<Content | undefined> {
  return queryOne<Content>(
    `UPDATE content SET status='suspended', suspended_reason=$2, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id, reason]
  );
}
export function reinstateContent(id: string): Promise<Content | undefined> {
  return queryOne<Content>(
    `UPDATE content SET status='published', suspended_reason=NULL, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id]
  );
}
export function deleteContent(id: string): Promise<unknown> {
  return query(`DELETE FROM content WHERE id=$1`, [id]);
}

/** Update content fields and optionally replace its chunks (re-chunk on edit). */
export async function updateContent(
  id: string,
  fields: { title?: string; summary?: string; tags?: string; pricePerBlock?: string; body?: string; status?: ContentStatus },
  rechunk?: { chunks: Array<{ text: string; isFree: boolean }>; firstBlockIndex: number }
): Promise<Content | undefined> {
  return tx(async (client) => {
    if (rechunk) {
      await client.query(`DELETE FROM chunks WHERE content_id = $1`, [id]);
      const base = rechunk.firstBlockIndex;
      for (let i = 0; i < rechunk.chunks.length; i++) {
        await client.query(`INSERT INTO chunks (content_id, block_index, text, is_free) VALUES ($1,$2,$3,$4)`, [
          id,
          base + i,
          rechunk.chunks[i].text,
          rechunk.chunks[i].isFree,
        ]);
      }
    }
    const blockCount = rechunk ? rechunk.chunks.filter((c) => !c.isFree).length : null;
    const res = await client.query<Content>(
      `UPDATE content SET
         title = COALESCE($2, title),
         summary = COALESCE($3, summary),
         tags = COALESCE($4, tags),
         price_per_block = COALESCE($5, price_per_block),
         body = COALESCE($6, body),
         status = COALESCE($7, status),
         block_count = COALESCE($8, block_count),
         published_at = CASE WHEN $7 = 'published' THEN COALESCE(published_at, NOW()) ELSE published_at END,
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        id,
        fields.title ?? null,
        fields.summary ?? null,
        fields.tags ?? null,
        fields.pricePerBlock ?? null,
        fields.body ?? null,
        fields.status ?? null,
        blockCount,
      ]
    );
    return res.rows[0];
  });
}
export function incrementView(id: string): Promise<unknown> {
  return query(`UPDATE content SET view_count = view_count + 1 WHERE id=$1`, [id]);
}

/** True if a creator has any published content (for the first-publish email). */
export async function creatorPublishedCount(creatorId: string): Promise<number> {
  const r = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM content WHERE creator_id=$1 AND status='published'`,
    [creatorId]
  );
  return Number(r?.count ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment ledger
// ─────────────────────────────────────────────────────────────────────────────

export interface InsertLedgerInput {
  contentId: string;
  creatorId: string;
  payerId: string;
  payerKind: PayerKind;
  blockIndex: number;
  grossAmount: string;
  creatorAmount: string;
  platformAmount: string;
  referrerAmount: string;
  reserveAmount?: string;
  referrerId?: string | null;
  paySessionId?: string | null;
  paymentToken?: string | null;
  txHash?: string | null;
  status: LedgerStatus;
}

/**
 * Insert a ledger row. Idempotent on payment_token: if a row with the same
 * token already exists, the existing row is returned (ON CONFLICT DO NOTHING).
 */
export async function insertLedger(input: InsertLedgerInput): Promise<LedgerRow> {
  const completedAt = input.status === "completed" ? new Date() : null;
  const inserted = await queryOne<LedgerRow>(
    `INSERT INTO payment_ledger
       (content_id, creator_id, payer_id, payer_kind, block_index, gross_amount,
        creator_amount, platform_amount, referrer_amount, reserve_amount, referrer_id,
        pay_session_id, payment_token, tx_hash, status, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (payment_token) WHERE payment_token IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      input.contentId,
      input.creatorId,
      input.payerId,
      input.payerKind,
      input.blockIndex,
      input.grossAmount,
      input.creatorAmount,
      input.platformAmount,
      input.referrerAmount,
      input.reserveAmount ?? "0",
      input.referrerId ?? null,
      input.paySessionId ?? null,
      input.paymentToken ?? null,
      input.txHash ?? null,
      input.status,
      completedAt,
    ]
  );
  if (inserted) return inserted;
  // Conflict → return the existing row for this token.
  const existing = await queryOne<LedgerRow>(
    `SELECT * FROM payment_ledger WHERE payment_token = $1`,
    [input.paymentToken]
  );
  if (!existing) throw new Error("ledger insert conflict but no existing row");
  return existing;
}

export function getLedgerByToken(token: string): Promise<LedgerRow | undefined> {
  return queryOne<LedgerRow>(`SELECT * FROM payment_ledger WHERE payment_token = $1`, [token]);
}

export function finalizeLedgerByToken(
  token: string,
  txHash?: string | null
): Promise<LedgerRow | undefined> {
  return queryOne<LedgerRow>(
    `UPDATE payment_ledger
       SET status='completed', completed_at=NOW(), tx_hash=COALESCE($2, tx_hash)
     WHERE payment_token=$1 AND status<>'completed'
     RETURNING *`,
    [token, txHash ?? null]
  );
}

export function failLedgerByToken(token: string): Promise<LedgerRow | undefined> {
  return queryOne<LedgerRow>(
    `UPDATE payment_ledger SET status='failed' WHERE payment_token=$1 AND status='pending' RETURNING *`,
    [token]
  );
}

/**
 * Persist the Gateway attestation + burn signature the moment a live silent
 * burn commits, so a stuck (pending) row can be retried (mint→split) later
 * without re-burning. Idempotent; only touches still-pending rows.
 */
export function setLedgerAttestation(
  token: string,
  attestation: string,
  burnSignature: string
): Promise<LedgerRow | undefined> {
  return queryOne<LedgerRow>(
    `UPDATE payment_ledger
       SET attestation = $2, burn_signature = $3
     WHERE payment_token = $1 AND status = 'pending' RETURNING *`,
    [token, attestation, burnSignature]
  );
}

/** Record the mint tx hash (so a settle retry skips re-minting). */
export function setLedgerMintTx(token: string, mintTx: string): Promise<LedgerRow | undefined> {
  return queryOne<LedgerRow>(
    `UPDATE payment_ledger SET mint_tx = $2 WHERE payment_token = $1 RETURNING *`,
    [token, mintTx]
  );
}

/** Pending ledger rows for admin reconciliation (oldest first). */
export function listPendingLedger(limit = 100): Promise<LedgerRowEnriched[]> {
  return query<LedgerRowEnriched>(
    `SELECT l.*,
            c.title AS content_title,
            c.slug  AS content_slug,
            u.display_name AS creator_name,
            u.handle AS creator_handle
     FROM payment_ledger l
     LEFT JOIN content c ON c.id = l.content_id
     LEFT JOIN users   u ON u.id = l.creator_id
     WHERE l.status = 'pending'
     ORDER BY l.created_at ASC
     LIMIT $1`,
    [Math.min(limit, 500)]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pay sessions (session-key silent payments — see migration 0003)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreatePaySessionInput {
  mainWallet: string;
  sessionAddress: string;
  cap: string;
  /** ISO timestamp or Date for expiry; null = no expiry. */
  expiresAt?: Date | null;
}

/**
 * Open a new session. Any existing active session for the SAME main wallet is
 * revoked first (a wallet runs one silent-pay session at a time), which also
 * frees the partial unique index on session_address.
 */
export async function createPaySession(input: CreatePaySessionInput): Promise<PaySessionRow> {
  return tx(async (client) => {
    await client.query(
      `UPDATE pay_sessions SET status='revoked', revoked_at=NOW()
         WHERE main_wallet=$1 AND status='active'`,
      [input.mainWallet]
    );
    const { rows } = await client.query<PaySessionRow>(
      `INSERT INTO pay_sessions (main_wallet, session_address, cap, expires_at)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [input.mainWallet, input.sessionAddress, input.cap, input.expiresAt ?? null]
    );
    return rows[0];
  });
}

export function getPaySessionById(id: string): Promise<PaySessionRow | undefined> {
  return queryOne<PaySessionRow>(`SELECT * FROM pay_sessions WHERE id = $1`, [id]);
}

export function getActivePaySession(mainWallet: string): Promise<PaySessionRow | undefined> {
  return queryOne<PaySessionRow>(
    `SELECT * FROM pay_sessions WHERE main_wallet = $1 AND status='active'
       ORDER BY created_at DESC LIMIT 1`,
    [mainWallet]
  );
}

/**
 * Atomically charge `amount` against a session's cap. Returns the updated row
 * on success, or null if the session is gone/inactive/expired or the charge
 * would exceed the cap. The single UPDATE is the concurrency guard.
 */
export async function chargePaySession(
  id: string,
  amount: string
): Promise<{ ok: true; session: PaySessionRow } | { ok: false; reason: string }> {
  const row = await queryOne<PaySessionRow>(
    `UPDATE pay_sessions
       SET spent = spent + $2
     WHERE id = $1
       AND status='active'
       AND (expires_at IS NULL OR expires_at > NOW())
       AND spent + $2 <= cap
     RETURNING *`,
    [id, amount]
  );
  if (row) return { ok: true, session: row };
  // Disambiguate the failure for a friendlier message.
  const current = await getPaySessionById(id);
  if (!current) return { ok: false, reason: "session_not_found" };
  if (current.status !== "active") return { ok: false, reason: `session_${current.status}` };
  if (current.expires_at && current.expires_at <= new Date()) return { ok: false, reason: "session_expired" };
  return { ok: false, reason: "cap_exceeded" };
}

export function revokePaySession(id: string): Promise<PaySessionRow | undefined> {
  return queryOne<PaySessionRow>(
    `UPDATE pay_sessions SET status='revoked', revoked_at=NOW()
       WHERE id=$1 AND status='active' RETURNING *`,
    [id]
  );
}

/** Earnings rollup for a creator (completed rows only). */
export async function creatorEarnings(creatorId: string): Promise<{
  totalEarned: string;
  pendingPayout: string;
  unlocks: number;
  todayEarned: string;
}> {
  const r = await queryOne<{
    total_earned: string;
    today_earned: string;
    unlocks: string;
  }>(
    `SELECT
       COALESCE(SUM(creator_amount) FILTER (WHERE status='completed'), 0)::text AS total_earned,
       COALESCE(SUM(creator_amount) FILTER (WHERE status='completed' AND created_at >= date_trunc('day', NOW())), 0)::text AS today_earned,
       COUNT(*) FILTER (WHERE status='completed')::text AS unlocks
     FROM payment_ledger WHERE creator_id = $1`,
    [creatorId]
  );
  const paid = await queryOne<{ paid: string }>(
    `SELECT COALESCE(SUM(amount),0)::text AS paid FROM payouts WHERE creator_id=$1 AND status<>'failed'`,
    [creatorId]
  );
  const totalEarned = r?.total_earned ?? "0";
  const pendingBase = BigInt(Math.round(Number(totalEarned) * 1e6)) - BigInt(Math.round(Number(paid?.paid ?? "0") * 1e6));
  const pendingPayout = (Number(pendingBase) / 1e6).toFixed(6);
  return {
    totalEarned,
    pendingPayout,
    unlocks: Number(r?.unlocks ?? 0),
    todayEarned: r?.today_earned ?? "0",
  };
}

export interface LedgerFilters {
  contentId?: string;
  creatorId?: string;
  payerKind?: PayerKind;
  status?: LedgerStatus;
  search?: string; // tx hash or payer/address
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function listLedger(f: LedgerFilters = {}): Promise<LedgerRowEnriched[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, val: unknown) => {
    params.push(val);
    where.push(clause.replace("$?", `$${params.length}`));
  };
  // Columns are qualified with `l.` since the query joins content + users.
  if (f.contentId) add(`l.content_id = $?`, f.contentId);
  if (f.creatorId) add(`l.creator_id = $?`, f.creatorId);
  if (f.payerKind) add(`l.payer_kind = $?`, f.payerKind);
  if (f.status) add(`l.status = $?`, f.status);
  if (f.from) add(`l.created_at >= $?`, f.from);
  if (f.to) add(`l.created_at <= $?`, f.to);
  if (f.search) {
    params.push(`%${f.search}%`);
    const p = `$${params.length}`;
    // Match tx hash / payer address, plus the human-readable content + creator.
    where.push(
      `(l.tx_hash ILIKE ${p} OR l.payer_id ILIKE ${p} OR c.title ILIKE ${p} OR u.display_name ILIKE ${p} OR u.handle ILIKE ${p})`
    );
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(Math.min(f.limit ?? 50, 500), f.offset ?? 0);
  return query<LedgerRowEnriched>(
    `SELECT l.*,
            c.title  AS content_title,
            c.slug   AS content_slug,
            u.display_name AS creator_name,
            u.handle AS creator_handle
     FROM payment_ledger l
     LEFT JOIN content c ON c.id = l.content_id
     LEFT JOIN users   u ON u.id = l.creator_id
     ${whereSql}
     ORDER BY l.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Payouts
// ─────────────────────────────────────────────────────────────────────────────

export function createPayout(creatorId: string, amount: string, wallet: string): Promise<Payout> {
  return queryOne<Payout>(
    `INSERT INTO payouts (creator_id, amount, wallet_address, status) VALUES ($1,$2,$3,'initiated') RETURNING *`,
    [creatorId, amount, wallet]
  ) as Promise<Payout>;
}
export function confirmPayout(id: string, txHash: string): Promise<Payout | undefined> {
  return queryOne<Payout>(
    `UPDATE payouts SET status='confirmed', tx_hash=$2, confirmed_at=NOW() WHERE id=$1 RETURNING *`,
    [id, txHash]
  );
}
export function listPayouts(creatorId: string): Promise<Payout[]> {
  return query<Payout>(`SELECT * FROM payouts WHERE creator_id=$1 ORDER BY created_at DESC`, [creatorId]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin events (the live activity stream source of truth)
// ─────────────────────────────────────────────────────────────────────────────

export interface RecordAdminEventInput {
  eventType: AdminEventType;
  actorId?: string | null;
  payerId?: string | null;
  contentId?: string | null;
  blockIndex?: number | null;
  amountGross?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function recordAdminEvent(input: RecordAdminEventInput): Promise<AdminEvent> {
  return queryOne<AdminEvent>(
    `INSERT INTO admin_events
       (event_type, actor_id, payer_id, content_id, block_index, amount_gross, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      input.eventType,
      input.actorId ?? null,
      input.payerId ?? null,
      input.contentId ?? null,
      input.blockIndex ?? null,
      input.amountGross ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  ) as Promise<AdminEvent>;
}

export function recentAdminEvents(limit = 500): Promise<AdminEvent[]> {
  return query<AdminEvent>(
    `SELECT * FROM admin_events ORDER BY created_at DESC LIMIT $1`,
    [Math.min(limit, 500)]
  );
}

/** Events strictly newer than a timestamp (SSE polling cursor). */
export function adminEventsAfter(after: Date, limit = 50): Promise<AdminEvent[]> {
  return query<AdminEvent>(
    `SELECT * FROM admin_events WHERE created_at > $1 ORDER BY created_at ASC LIMIT $2`,
    [after, limit]
  );
}

/** Replay events newer than a given event id (for SSE Last-Event-ID). */
export async function adminEventsSince(lastEventId: string, limit = 20): Promise<AdminEvent[]> {
  const anchor = await queryOne<{ created_at: Date }>(
    `SELECT created_at FROM admin_events WHERE id = $1`,
    [lastEventId]
  );
  if (!anchor) return [];
  return query<AdminEvent>(
    `SELECT * FROM admin_events WHERE created_at > $1 ORDER BY created_at ASC LIMIT $2`,
    [anchor.created_at, limit]
  );
}

/** Retention: delete events older than N days. Returns deleted count. */
export async function pruneAdminEvents(days = 90): Promise<number> {
  const r = await query<{ id: string }>(
    `DELETE FROM admin_events WHERE created_at < NOW() - ($1 || ' days')::interval RETURNING id`,
    [String(days)]
  );
  return r.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent sessions
// ─────────────────────────────────────────────────────────────────────────────

export function upsertAgentSession(
  sessionKey: string,
  ip: string | null,
  userAgent: string | null
): Promise<AgentSession> {
  return queryOne<AgentSession>(
    `INSERT INTO agent_sessions (session_key, ip, user_agent)
       VALUES ($1,$2,$3)
     ON CONFLICT (session_key) DO UPDATE SET last_seen = NOW(),
       ip = COALESCE(agent_sessions.ip, EXCLUDED.ip),
       user_agent = COALESCE(agent_sessions.user_agent, EXCLUDED.user_agent)
     RETURNING *`,
    [sessionKey, ip, userAgent]
  ) as Promise<AgentSession>;
}

export function getAgentSession(sessionKey: string): Promise<AgentSession | undefined> {
  return queryOne<AgentSession>(`SELECT * FROM agent_sessions WHERE session_key = $1`, [sessionKey]);
}

export function bumpAgent402(sessionKey: string): Promise<unknown> {
  return query(
    `UPDATE agent_sessions SET total_402_hits = total_402_hits + 1, last_seen = NOW() WHERE session_key = $1`,
    [sessionKey]
  );
}
export function bumpAgentUnlock(sessionKey: string, spentUsdc: string): Promise<unknown> {
  return query(
    `UPDATE agent_sessions
       SET total_unlocks = total_unlocks + 1,
           total_spent_usdc = total_spent_usdc + $2,
           last_seen = NOW()
     WHERE session_key = $1`,
    [sessionKey, spentUsdc]
  );
}
export function setAgentBlocked(sessionKey: string, blocked: boolean): Promise<AgentSession | undefined> {
  return queryOne<AgentSession>(
    `UPDATE agent_sessions SET blocked=$2 WHERE session_key=$1 RETURNING *`,
    [sessionKey, blocked]
  );
}
export function setAgentTrusted(sessionKey: string, trusted: boolean): Promise<AgentSession | undefined> {
  return queryOne<AgentSession>(
    `UPDATE agent_sessions SET trusted=$2 WHERE session_key=$1 RETURNING *`,
    [sessionKey, trusted]
  );
}
/** Append a note to the agent session behind a payer_id like 'agent:<key>'. */
export function flagAgentSessionByPayer(payerId: string, note: string): Promise<unknown> {
  const sessionKey = payerId.startsWith("agent:") ? payerId.slice("agent:".length) : payerId;
  return query(
    `UPDATE agent_sessions
       SET notes = COALESCE(notes || ' | ', '') || $2, last_seen = NOW()
     WHERE session_key = $1`,
    [sessionKey, note]
  );
}

export function listAgentSessions(limit = 100): Promise<AgentSession[]> {
  return query<AgentSession>(
    `SELECT * FROM agent_sessions ORDER BY last_seen DESC LIMIT $1`,
    [Math.min(limit, 500)]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Named counters (discovery funnel)
// ─────────────────────────────────────────────────────────────────────────────

export function bumpCounter(key: string): Promise<unknown> {
  return query(
    `INSERT INTO counters (key, value) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET value = counters.value + 1`,
    [key]
  );
}

export async function getCounter(key: string): Promise<number> {
  const r = await queryOne<{ value: string }>(`SELECT value::text AS value FROM counters WHERE key = $1`, [key]);
  return Number(r?.value ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Health probes
// ─────────────────────────────────────────────────────────────────────────────

export function lastCompletedPayment(): Promise<{ created_at: Date; gross_amount: string } | undefined> {
  return queryOne<{ created_at: Date; gross_amount: string }>(
    `SELECT created_at, gross_amount FROM payment_ledger WHERE status='completed' ORDER BY created_at DESC LIMIT 1`
  );
}
export function lastSignup(): Promise<{ created_at: Date } | undefined> {
  return queryOne<{ created_at: Date }>(`SELECT created_at FROM users ORDER BY created_at DESC LIMIT 1`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Export jobs (async CSV)
// ─────────────────────────────────────────────────────────────────────────────

export function createExportJob(adminId: string, filters: Record<string, unknown>): Promise<ExportJob> {
  return queryOne<ExportJob>(
    `INSERT INTO export_jobs (admin_id, filters, status) VALUES ($1,$2,'pending') RETURNING *`,
    [adminId, JSON.stringify(filters)]
  ) as Promise<ExportJob>;
}
export function getExportJob(id: string): Promise<ExportJob | undefined> {
  return queryOne<ExportJob>(`SELECT * FROM export_jobs WHERE id = $1`, [id]);
}
export function updateExportJob(
  id: string,
  patch: { status?: string; rowCount?: number; filePath?: string; completed?: boolean }
): Promise<ExportJob | undefined> {
  return queryOne<ExportJob>(
    `UPDATE export_jobs SET
       status = COALESCE($2, status),
       row_count = COALESCE($3, row_count),
       file_path = COALESCE($4, file_path),
       completed_at = CASE WHEN $5 THEN NOW() ELSE completed_at END
     WHERE id = $1 RETURNING *`,
    [id, patch.status ?? null, patch.rowCount ?? null, patch.filePath ?? null, patch.completed ?? false]
  );
}
