/**
 * Postgres data-access layer. All SQL lives here; routes call typed functions.
 * Replaces the legacy SQLite line-based store. Amounts are decimal USDC strings.
 */
import { query, queryOne, tx } from "./db.js";
import type {
  AdminEvent,
  AdminEventType,
  AgentSession,
  Chapter,
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
  Report,
  ReportEnriched,
  ReportStatus,
  ReportType,
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
  const code = `skimflow-verify-${process.hrtime.bigint().toString(36).slice(-10)}`;
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
 * Replace a user's embedded wallet with a freshly-provisioned one (used to swap
 * legacy user-controlled wallets for developer-controlled wallets). Overwrites
 * the embedded id+address unconditionally, and re-points the active payout to
 * the new address ONLY when it was already routing to the embedded wallet (so a
 * deliberately-linked external payout is preserved). The CASE reads the OLD row
 * values, so `wallet_address = embedded_wallet_address` matches the prior embed.
 */
export function replaceEmbeddedWallet(
  id: string,
  walletId: string,
  address: string
): Promise<User | undefined> {
  return queryOne<User>(
    `UPDATE users
       SET embedded_wallet_id = $2,
           embedded_wallet_address = $3,
           wallet_address = CASE
             WHEN wallet_source = 'embedded' OR wallet_address IS NULL OR wallet_address = embedded_wallet_address
               THEN $3 ELSE wallet_address END,
           wallet_source = CASE
             WHEN wallet_source = 'embedded' OR wallet_address IS NULL OR wallet_address = embedded_wallet_address
               THEN 'embedded' ELSE wallet_source END
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

export interface EmailRecipientRow {
  id: string;
  email: string;
  display_name: string | null;
  name: string | null;
  handle: string | null;
}

/** Users with a deliverable email address — for admin broadcast sends. */
export function listUsersForEmail(role?: UserRole): Promise<EmailRecipientRow[]> {
  const where = ["email IS NOT NULL", "TRIM(email) <> ''", "suspended = false"];
  const params: unknown[] = [];
  if (role) {
    params.push(role);
    where.push(`role = $${params.length}`);
  }
  return query<EmailRecipientRow>(
    `SELECT id, email, display_name, name, handle FROM users WHERE ${where.join(" AND ")} ORDER BY created_at ASC`,
    params
  );
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
  /** Chunks to store, in order. Picture posts also carry imageUrl/caption. */
  chunks: Array<{ text: string; isFree: boolean; imageUrl?: string | null; caption?: string | null }>;
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
        `INSERT INTO chunks (content_id, block_index, text, is_free, image_url, caption)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [content.id, base + i, c.text, c.isFree, c.imageUrl ?? null, c.caption ?? null]
      );
    }
    return content;
  });
}

// ── Books (content_type='book' parent + chapters + pages-as-chunks) ──────────

export interface CreateBookInput {
  creatorId: string;
  slug: string;
  title: string;
  description?: string;
  coverImageUrl?: string | null;
  pricePerBlock: string; // decimal USDC, per page
  gatewayAddress?: string | null;
  tags?: string;
  status?: ContentStatus;
  /** Ordered chapters; each carries its already-split pages (page text, in order). */
  chapters: Array<{ title: string; pages: string[] }>;
}

/**
 * Create a book atomically: the `content` parent row (content_type='book'),
 * one `chapters` row per chapter, and one `chunks` row per page. Pages get a
 * single global, sequential block_index across the whole book (page 0 free);
 * each page links to its chapter via chapter_id. block_count = payable pages.
 */
export async function createBook(input: CreateBookInput): Promise<Content> {
  return tx(async (client) => {
    const totalPages = input.chapters.reduce((n, ch) => n + ch.pages.length, 0);
    const res = await client.query<Content>(
      `INSERT INTO content
         (creator_id, slug, title, summary, tags, content_type, body, price_per_block,
          cover_image_url, gateway_address, status, block_count, published_at)
       VALUES ($1,$2,$3,$4,$5,'book','',$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        input.creatorId,
        input.slug,
        input.title,
        input.description ?? "",
        input.tags ?? "",
        input.pricePerBlock,
        input.coverImageUrl ?? null,
        input.gatewayAddress ?? null,
        input.status ?? "draft",
        Math.max(0, totalPages - 1), // payable pages (page 0 is the free preview)
        input.status === "published" ? new Date() : null,
      ]
    );
    const content = res.rows[0];

    let blockIndex = 0;
    for (let ci = 0; ci < input.chapters.length; ci++) {
      const ch = input.chapters[ci];
      const chapterRow = await client.query<{ id: string }>(
        `INSERT INTO chapters (content_id, chapter_index, title) VALUES ($1,$2,$3) RETURNING id`,
        [content.id, ci, ch.title]
      );
      const chapterId = chapterRow.rows[0].id;
      for (const page of ch.pages) {
        await client.query(
          `INSERT INTO chunks (content_id, block_index, text, is_free, chapter_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [content.id, blockIndex, page, blockIndex === 0, chapterId]
        );
        blockIndex++;
      }
    }
    return content;
  });
}

/**
 * Update a book in place: refresh the content row and REPLACE its chapters +
 * pages (delete then re-insert) so an edit can add/remove/reorder pages freely.
 * Deleting chapters cascades their chunks (chunks.chapter_id ON DELETE CASCADE).
 * Atomic. block_count is recomputed (page 0 stays the free preview).
 */
export async function updateBook(
  id: string,
  input: Omit<CreateBookInput, "creatorId" | "slug">
): Promise<Content> {
  return tx(async (client) => {
    const totalPages = input.chapters.reduce((n, ch) => n + ch.pages.length, 0);
    const res = await client.query<Content>(
      `UPDATE content SET
         title = $2, summary = $3, tags = $4, price_per_block = $5,
         cover_image_url = $6, status = $7, block_count = $8,
         published_at = COALESCE(published_at, $9), updated_at = NOW()
       WHERE id = $1 AND content_type = 'book'
       RETURNING *`,
      [
        id,
        input.title,
        input.description ?? "",
        input.tags ?? "",
        input.pricePerBlock,
        input.coverImageUrl ?? null,
        input.status ?? "draft",
        Math.max(0, totalPages - 1),
        input.status === "published" ? new Date() : null,
      ]
    );
    const content = res.rows[0];
    if (!content) throw new Error("book_not_found");

    // Replace chapters (cascades chunks) then re-insert from scratch.
    await client.query(`DELETE FROM chapters WHERE content_id = $1`, [id]);
    let blockIndex = 0;
    for (let ci = 0; ci < input.chapters.length; ci++) {
      const ch = input.chapters[ci];
      const chapterRow = await client.query<{ id: string }>(
        `INSERT INTO chapters (content_id, chapter_index, title) VALUES ($1,$2,$3) RETURNING id`,
        [id, ci, ch.title]
      );
      const chapterId = chapterRow.rows[0].id;
      for (const page of ch.pages) {
        await client.query(
          `INSERT INTO chunks (content_id, block_index, text, is_free, chapter_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [id, blockIndex, page, blockIndex === 0, chapterId]
        );
        blockIndex++;
      }
    }
    return content;
  });
}

/** Ordered chapters of a book, by chapter_index. */
export function getChapters(contentId: string): Promise<Chapter[]> {
  return query<Chapter>(
    `SELECT * FROM chapters WHERE content_id = $1 ORDER BY chapter_index ASC`,
    [contentId]
  );
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

/**
 * The single FREE preview block for a content (is_free = TRUE). The SQL filter
 * guarantees paid block text is never loaded — the safe source for public
 * teasers (posts API + RSS). Returns undefined for content whose free block
 * isn't stored (e.g. agent-skills, whose block 0 is generated, not in the DB).
 */
export function getFreeBlock(contentId: string): Promise<Chunk | undefined> {
  return queryOne<Chunk>(
    `SELECT * FROM chunks WHERE content_id = $1 AND is_free = TRUE ORDER BY block_index ASC LIMIT 1`,
    [contentId]
  );
}

/** Number of payable (non-free) chunks — used for whole-piece pricing. */
export function payableChunkCount(contentId: string): Promise<number> {
  return queryOne<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM chunks WHERE content_id = $1 AND is_free = FALSE`,
    [contentId]
  ).then((r) => Number(r?.n ?? 0));
}

/** Highest block_index for a piece — used to detect the final (never-optimistic) chunk. */
export function maxBlockIndex(contentId: string): Promise<number> {
  return queryOne<{ max: number | null }>(
    `SELECT MAX(block_index) AS max FROM chunks WHERE content_id = $1`,
    [contentId]
  ).then((r) => (r?.max == null ? 0 : Number(r.max)));
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

/**
 * A creator's PUBLISHED content only, newest first — the data source for the
 * public posts API + RSS feed. Suspended/draft are excluded. Paginated; returns
 * one extra row beyond `limit` is NOT done here (callers pass limit+1 if they
 * want a hasMore hint, or use a separate count).
 */
export function listPublishedByCreator(
  creatorId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<Content[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  return query<Content>(
    `SELECT * FROM content
       WHERE creator_id = $1 AND status = 'published'
       ORDER BY COALESCE(published_at, created_at) DESC
       LIMIT $2 OFFSET $3`,
    [creatorId, limit, offset]
  );
}

/** Total count of a creator's published content (for pagination metadata). */
export async function countPublishedByCreator(creatorId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM content WHERE creator_id = $1 AND status = 'published'`,
    [creatorId]
  );
  return Number(row?.count ?? 0);
}

export interface MarketplaceFilters {
  contentType?: ContentType;
  /** Content types to exclude (e.g. exclude 'agent-skills' from the All feed). */
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

/** Lightweight list of published content for the XML sitemap (slug + lastmod). */
export function listSitemapContent(): Promise<
  { slug: string; updated_at: Date; published_at: Date | null }[]
> {
  return query(
    `SELECT slug, updated_at, published_at
     FROM content
     WHERE status = 'published'
     ORDER BY published_at DESC NULLS LAST
     LIMIT 5000`,
    []
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
  /** Reader was shown the chunk before payment confirmed (optimistic unlock, §3). */
  optimistic?: boolean;
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
        pay_session_id, payment_token, tx_hash, status, optimistic, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
      input.optimistic ?? false,
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

/**
 * Re-activate the most recent (non-expired) session for a wallet + session key
 * that was paused/revoked. Used to resume silent paying against an
 * already-funded Gateway balance without a fresh deposit — the cap/spent tally
 * is preserved, so the remaining "reading fuel" reflects what's actually left.
 * Returns undefined when there's no prior session to resume. Any *other* active
 * session for the wallet is revoked first (one session per wallet; this also
 * frees the partial unique index on session_address).
 */
export async function resumePaySession(
  mainWallet: string,
  sessionAddress: string
): Promise<PaySessionRow | undefined> {
  return tx(async (client) => {
    const { rows: candidates } = await client.query<PaySessionRow>(
      `SELECT * FROM pay_sessions
         WHERE main_wallet=$1 AND session_address=$2
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC LIMIT 1`,
      [mainWallet, sessionAddress]
    );
    const target = candidates[0];
    if (!target) return undefined;
    await client.query(
      `UPDATE pay_sessions SET status='revoked', revoked_at=NOW()
         WHERE main_wallet=$1 AND status='active' AND id<>$2`,
      [mainWallet, target.id]
    );
    const { rows } = await client.query<PaySessionRow>(
      `UPDATE pay_sessions SET status='active', revoked_at=NULL WHERE id=$1 RETURNING *`,
      [target.id]
    );
    return rows[0];
  });
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

// ── Reports (admin moderation inbox) ─────────────────────────────────────────
export interface CreateReportInput {
  reportType: ReportType;
  reason?: string | null;
  detail?: string | null;
  contentId?: string | null;
  blockIndex?: number | null;
  creatorId?: string | null;
  reporterId?: string | null;
  reporterLabel?: string | null;
  amountPaid?: string | null;
}

export function createReport(input: CreateReportInput): Promise<Report> {
  return queryOne<Report>(
    `INSERT INTO reports
       (report_type, reason, detail, content_id, block_index, creator_id,
        reporter_id, reporter_label, amount_paid)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      input.reportType,
      input.reason ?? null,
      input.detail ?? null,
      input.contentId ?? null,
      input.blockIndex ?? null,
      input.creatorId ?? null,
      input.reporterId ?? null,
      input.reporterLabel ?? null,
      input.amountPaid ?? null,
    ]
  ) as Promise<Report>;
}

/** List reports for the admin inbox, newest first, optionally by status. */
export function listReports(status?: ReportStatus, limit = 200): Promise<ReportEnriched[]> {
  const params: unknown[] = [];
  let where = "";
  if (status) {
    params.push(status);
    where = `WHERE r.status = $${params.length}`;
  }
  params.push(Math.min(limit, 500));
  return query<ReportEnriched>(
    `SELECT r.*, c.title AS content_title, c.slug AS content_slug, u.handle AS creator_handle
       FROM reports r
       LEFT JOIN content c ON c.id = r.content_id
       LEFT JOIN users u   ON u.id = r.creator_id
       ${where}
      ORDER BY r.created_at DESC
      LIMIT $${params.length}`,
    params
  );
}

export function setReportStatus(id: string, status: ReportStatus): Promise<Report | undefined> {
  return queryOne<Report>(
    `UPDATE reports SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, status]
  );
}

export function openReportCount(): Promise<number> {
  return queryOne<{ n: string }>(`SELECT COUNT(*)::int AS n FROM reports WHERE status = 'open'`, []).then(
    (r) => Number(r?.n ?? 0)
  );
}

/**
 * Count distinct paying readers for a specific content block (or the whole
 * content when blockIndex is null). Used by the §5d content lock — once this
 * crosses the threshold a chunk/image can only be removed by an admin.
 */
export function countPaidReaders(contentId: string, blockIndex?: number | null): Promise<number> {
  const params: unknown[] = [contentId];
  let blockClause = "";
  if (blockIndex != null) {
    params.push(blockIndex);
    blockClause = ` AND block_index = $${params.length}`;
  }
  return queryOne<{ n: string }>(
    `SELECT COUNT(DISTINCT payer_id)::int AS n FROM payment_ledger
      WHERE content_id = $1 AND status = 'completed'${blockClause}`,
    params
  ).then((r) => Number(r?.n ?? 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// Ghost integration (migration 0012) — credentials stored ENCRYPTED at rest.
// This layer never decrypts; callers (the webhook receiver) decrypt via
// lib/secrets.ts. The Admin API key column never leaves the server in plaintext.
// ─────────────────────────────────────────────────────────────────────────────

export type GhostConnectionStatus = "unconnected" | "connected" | "error";

export interface GhostIntegrationRow {
  creator_id: string;
  site_url: string;
  content_api_key_enc: string;
  admin_api_key_enc: string;
  default_monetization: "free" | "paid";
  auto_publish: boolean;
  connection_status: GhostConnectionStatus;
  last_error: string | null;
  last_event_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function getGhostIntegration(creatorId: string): Promise<GhostIntegrationRow | undefined> {
  return queryOne<GhostIntegrationRow>(`SELECT * FROM ghost_integrations WHERE creator_id = $1`, [creatorId]);
}

export interface UpsertGhostIntegrationInput {
  creatorId: string;
  siteUrl: string;
  contentApiKeyEnc: string;
  adminApiKeyEnc: string;
  defaultMonetization: "free" | "paid";
  autoPublish: boolean;
}

/** Create or update a creator's Ghost connection. Resets status to 'unconnected'
 *  (a fresh connection is confirmed only by the first successful webhook). */
export function upsertGhostIntegration(input: UpsertGhostIntegrationInput): Promise<GhostIntegrationRow | undefined> {
  return queryOne<GhostIntegrationRow>(
    `INSERT INTO ghost_integrations
       (creator_id, site_url, content_api_key_enc, admin_api_key_enc, default_monetization, auto_publish, connection_status, last_error)
     VALUES ($1,$2,$3,$4,$5,$6,'unconnected',NULL)
     ON CONFLICT (creator_id) DO UPDATE SET
       site_url = EXCLUDED.site_url,
       content_api_key_enc = EXCLUDED.content_api_key_enc,
       admin_api_key_enc = EXCLUDED.admin_api_key_enc,
       default_monetization = EXCLUDED.default_monetization,
       auto_publish = EXCLUDED.auto_publish,
       connection_status = 'unconnected',
       last_error = NULL,
       updated_at = NOW()
     RETURNING *`,
    [input.creatorId, input.siteUrl, input.contentApiKeyEnc, input.adminApiKeyEnc, input.defaultMonetization, input.autoPublish]
  );
}

/** Update only the saved options (toggles) without touching credentials. */
export function updateGhostOptions(
  creatorId: string,
  opts: { defaultMonetization?: "free" | "paid"; autoPublish?: boolean }
): Promise<GhostIntegrationRow | undefined> {
  return queryOne<GhostIntegrationRow>(
    `UPDATE ghost_integrations
        SET default_monetization = COALESCE($2, default_monetization),
            auto_publish = COALESCE($3, auto_publish),
            updated_at = NOW()
      WHERE creator_id = $1 RETURNING *`,
    [creatorId, opts.defaultMonetization ?? null, opts.autoPublish ?? null]
  );
}

export function setGhostConnectionStatus(
  creatorId: string,
  status: GhostConnectionStatus,
  lastError: string | null = null
): Promise<GhostIntegrationRow | undefined> {
  return queryOne<GhostIntegrationRow>(
    `UPDATE ghost_integrations
        SET connection_status = $2,
            last_error = $3,
            last_event_at = CASE WHEN $2 = 'connected' THEN NOW() ELSE last_event_at END,
            updated_at = NOW()
      WHERE creator_id = $1 RETURNING *`,
    [creatorId, status, lastError]
  );
}

export function deleteGhostIntegration(creatorId: string): Promise<unknown> {
  return query(`DELETE FROM ghost_integrations WHERE creator_id = $1`, [creatorId]);
}

// ── Ghost post idempotency map ───────────────────────────────────────────────

export interface GhostPostMapRow {
  ghost_post_id: string;
  creator_id: string;
  content_id: string;
  created_at: Date;
}

export function getGhostPostMap(ghostPostId: string): Promise<GhostPostMapRow | undefined> {
  return queryOne<GhostPostMapRow>(`SELECT * FROM ghost_post_map WHERE ghost_post_id = $1`, [ghostPostId]);
}

/** Record that a Ghost post became a Skimflow content. Idempotent: a duplicate
 *  ghost_post_id is ignored (ON CONFLICT DO NOTHING) and returns undefined. */
export function insertGhostPostMap(
  ghostPostId: string,
  creatorId: string,
  contentId: string
): Promise<GhostPostMapRow | undefined> {
  return queryOne<GhostPostMapRow>(
    `INSERT INTO ghost_post_map (ghost_post_id, creator_id, content_id)
     VALUES ($1,$2,$3) ON CONFLICT (ghost_post_id) DO NOTHING RETURNING *`,
    [ghostPostId, creatorId, contentId]
  );
}

// ── In-app notifications (migration 0012) ────────────────────────────────────

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export function createNotification(input: {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<NotificationRow | undefined> {
  return queryOne<NotificationRow>(
    `INSERT INTO notifications (user_id, type, title, body, link, metadata)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.userId, input.type, input.title, input.body ?? "", input.link ?? null, input.metadata ?? null]
  );
}

export function listNotifications(userId: string, limit = 20): Promise<NotificationRow[]> {
  return query<NotificationRow>(
    `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
}

export function unreadNotificationCount(userId: string): Promise<number> {
  return queryOne<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read = FALSE`,
    [userId]
  ).then((r) => Number(r?.n ?? 0));
}

export function markNotificationsRead(userId: string, ids?: string[]): Promise<unknown> {
  if (ids && ids.length > 0) {
    return query(`UPDATE notifications SET read = TRUE WHERE user_id = $1 AND id = ANY($2::uuid[])`, [userId, ids]);
  }
  return query(`UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`, [userId]);
}

// ═══════════════════════════════════════════════════════════════════════════
// Social layer (migration 0013): follows, comments, social notifications.
// All NEW functions — the existing notification helpers above are untouched.
// "Posts" are `content` rows; a post's author is content.creator_id.
// ═══════════════════════════════════════════════════════════════════════════

// ── Follows ──────────────────────────────────────────────────────────────────

export interface FollowRow {
  id: string;
  follower_id: string;
  following_id: string;
  created_at: Date;
}

/**
 * Follow a user. Idempotent: a duplicate (follower, following) pair is a no-op
 * (ON CONFLICT DO NOTHING), returning undefined when the edge already existed.
 * Self-follows are rejected at the API layer, not here.
 */
export function followUser(followerId: string, followingId: string): Promise<FollowRow | undefined> {
  return queryOne<FollowRow>(
    `INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)
     ON CONFLICT (follower_id, following_id) DO NOTHING
     RETURNING *`,
    [followerId, followingId]
  );
}

/** Remove a follow edge. No-op if it doesn't exist. */
export function unfollowUser(followerId: string, followingId: string): Promise<unknown> {
  return query(`DELETE FROM follows WHERE follower_id = $1 AND following_id = $2`, [followerId, followingId]);
}

export function isFollowing(followerId: string, followingId: string): Promise<boolean> {
  return queryOne<{ x: number }>(
    `SELECT 1 AS x FROM follows WHERE follower_id = $1 AND following_id = $2`,
    [followerId, followingId]
  ).then((r) => !!r);
}

/** How many users follow `userId`. */
export function getFollowerCount(userId: string): Promise<number> {
  return queryOne<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM follows WHERE following_id = $1`,
    [userId]
  ).then((r) => Number(r?.n ?? 0));
}

/** How many users `userId` follows. */
export function getFollowingCount(userId: string): Promise<number> {
  return queryOne<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM follows WHERE follower_id = $1`,
    [userId]
  ).then((r) => Number(r?.n ?? 0));
}

/**
 * Strictly-chronological feed of PUBLISHED content from everyone `userId`
 * follows (newest first), paginated by 1-based `page`. Same row shape as the
 * marketplace feed (ContentWithCreator) so callers serialize it identically.
 */
export function getFollowingFeed(userId: string, page = 1, limit = 20): Promise<ContentWithCreator[]> {
  const lim = Math.min(Math.max(limit, 1), 50);
  const offset = Math.max((Math.max(page, 1) - 1) * lim, 0);
  return query<ContentWithCreator>(
    `SELECT c.*, u.handle AS creator_handle, u.display_name AS creator_name,
            u.avatar AS creator_avatar, u.verified AS creator_verified
       FROM content c
       JOIN users u ON u.id = c.creator_id
      WHERE c.status = 'published'
        AND c.creator_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
      ORDER BY COALESCE(c.published_at, c.created_at) DESC
      LIMIT $2 OFFSET $3`,
    [userId, lim, offset]
  );
}

export interface SuggestedCreator {
  id: string;
  display_name: string | null;
  handle: string | null;
  name: string | null;
  avatar: string | null;
  bio: string | null;
}

/**
 * Up to `limit` random creators for `userId` to follow: active creators (not
 * the user, not already followed) who have at least one published piece. Powers
 * the "follow nobody" empty state on the following feed.
 */
export function getSuggestedCreators(userId: string, limit = 5): Promise<SuggestedCreator[]> {
  return query<SuggestedCreator>(
    `SELECT id, display_name, handle, name, avatar, bio
       FROM users
      WHERE role = 'creator' AND suspended = FALSE AND id <> $1
        AND id NOT IN (SELECT following_id FROM follows WHERE follower_id = $1)
        AND EXISTS (SELECT 1 FROM content WHERE creator_id = users.id AND status = 'published')
      ORDER BY RANDOM()
      LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 20)]
  );
}

// ── Comments ─────────────────────────────────────────────────────────────────

export interface CommentRow {
  id: string;
  post_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  created_at: Date;
  updated_at: Date;
}

export interface CommentWithAuthor extends CommentRow {
  author_name: string | null;
  author_handle: string | null;
  author_avatar: string | null;
  /** Direct replies to this comment (present on top-level rows only). */
  reply_count?: number;
}

const COMMENT_AUTHOR_COLS = `
  cm.id, cm.post_id, cm.user_id, cm.parent_id, cm.content, cm.created_at, cm.updated_at,
  u.display_name AS author_name, u.handle AS author_handle, u.avatar AS author_avatar`;

/** A single comment with author info (or undefined). */
export function getCommentById(commentId: string): Promise<CommentWithAuthor | undefined> {
  return queryOne<CommentWithAuthor>(
    `SELECT ${COMMENT_AUTHOR_COLS}
       FROM comments cm JOIN users u ON u.id = cm.user_id
      WHERE cm.id = $1`,
    [commentId]
  );
}

/**
 * Top-level comments for a post (parent_id IS NULL), newest first, paginated by
 * 1-based `page`. Each row carries its author and a count of direct replies.
 */
export function getCommentsByPost(postId: string, page = 1, limit = 20): Promise<CommentWithAuthor[]> {
  const lim = Math.min(Math.max(limit, 1), 100);
  const offset = Math.max((Math.max(page, 1) - 1) * lim, 0);
  return query<CommentWithAuthor>(
    `SELECT ${COMMENT_AUTHOR_COLS},
            (SELECT COUNT(*)::int FROM comments r WHERE r.parent_id = cm.id) AS reply_count
       FROM comments cm JOIN users u ON u.id = cm.user_id
      WHERE cm.post_id = $1 AND cm.parent_id IS NULL
      ORDER BY cm.created_at DESC
      LIMIT $2 OFFSET $3`,
    [postId, lim, offset]
  );
}

/** All replies to a comment, oldest first (chronological reading order). */
export function getRepliesByComment(commentId: string): Promise<CommentWithAuthor[]> {
  return query<CommentWithAuthor>(
    `SELECT ${COMMENT_AUTHOR_COLS}
       FROM comments cm JOIN users u ON u.id = cm.user_id
      WHERE cm.parent_id = $1
      ORDER BY cm.created_at ASC`,
    [commentId]
  );
}

/** Total comments on a post (top-level + replies). */
export function getCommentCount(postId: string): Promise<number> {
  return queryOne<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM comments WHERE post_id = $1`,
    [postId]
  ).then((r) => Number(r?.n ?? 0));
}

/**
 * Create a comment (or reply when `parentId` is given) and return it with author
 * info. Enforces single-level nesting at the store layer:
 *   • the parent must exist and belong to the SAME post, else throws.
 *   • the parent must itself be top-level (parent_id IS NULL) — replying to a
 *     reply throws.
 */
export async function createComment(
  postId: string,
  userId: string,
  content: string,
  parentId?: string | null
): Promise<CommentWithAuthor> {
  if (parentId) {
    const parent = await queryOne<CommentRow>(`SELECT * FROM comments WHERE id = $1`, [parentId]);
    if (!parent || parent.post_id !== postId) {
      throw new Error("invalid_parent");
    }
    if (parent.parent_id !== null) {
      throw new Error("nesting_too_deep");
    }
  }
  const inserted = await queryOne<CommentRow>(
    `INSERT INTO comments (post_id, user_id, content, parent_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [postId, userId, content, parentId ?? null]
  );
  // Re-read with author info so the caller gets a uniform shape.
  const withAuthor = await getCommentById(inserted!.id);
  return withAuthor!;
}

/** Delete a comment, but only if `userId` is its author. Returns whether a row was removed. */
export async function deleteComment(commentId: string, userId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM comments WHERE id = $1 AND user_id = $2 RETURNING id`,
    [commentId, userId]
  );
  return rows.length > 0;
}

// ── Social notifications (extend the 0012 notifications table) ───────────────
// Distinct from createNotification/listNotifications above (those carry Ghost
// title/body/link). These reference an actor + optional post/comment; the
// recipient-facing text is rendered client-side from those refs.

export type SocialNotificationType = "new_follower" | "post_comment" | "comment_reply" | "post_like";

export interface NotificationEnriched {
  id: string;
  user_id: string;
  type: string;
  title: string | null;
  body: string;
  link: string | null;
  read: boolean;
  created_at: Date;
  actor_id: string | null;
  post_id: string | null;
  comment_id: string | null;
  actor_name: string | null;
  actor_handle: string | null;
  actor_avatar: string | null;
  post_title: string | null;
  post_slug: string | null;
  /** First 60 chars of the referenced comment, when comment_id is set. */
  comment_preview: string | null;
}

/**
 * Create a social notification. Fire-and-forget: NEVER throws (logs instead),
 * and skips self-notifications (recipient === actor).
 */
export async function createSocialNotification(
  userId: string,
  actorId: string,
  type: SocialNotificationType,
  postId?: string | null,
  commentId?: string | null
): Promise<void> {
  if (userId === actorId) return;
  try {
    await query(
      `INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, actorId, type, postId ?? null, commentId ?? null]
    );
  } catch (e) {
    console.error("[createSocialNotification]", (e as Error)?.message ?? e);
  }
}

/**
 * A user's notifications (newest first), paginated by 1-based `page`, enriched
 * with actor info, referenced post title/slug, and a 60-char comment preview.
 * Returns BOTH social and legacy (Ghost) rows under the one unified list.
 */
export function listNotificationsEnriched(userId: string, page = 1, limit = 20): Promise<NotificationEnriched[]> {
  const lim = Math.min(Math.max(limit, 1), 100);
  const offset = Math.max((Math.max(page, 1) - 1) * lim, 0);
  return query<NotificationEnriched>(
    `SELECT n.id, n.user_id, n.type, n.title, n.body, n.link, n.read, n.created_at,
            n.actor_id, n.post_id, n.comment_id,
            a.display_name AS actor_name, a.handle AS actor_handle, a.avatar AS actor_avatar,
            ct.title AS post_title, ct.slug AS post_slug,
            LEFT(cm.content, 60) AS comment_preview
       FROM notifications n
       LEFT JOIN users a    ON a.id  = n.actor_id
       LEFT JOIN content ct ON ct.id = n.post_id
       LEFT JOIN comments cm ON cm.id = n.comment_id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, lim, offset]
  );
}

/** Mark every unread notification for a user as read. */
export function markAllNotificationsRead(userId: string): Promise<unknown> {
  return query(`UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`, [userId]);
}

/** Mark one notification read — scoped to its owner so users can't touch others'. */
export function markNotificationRead(notificationId: string, userId: string): Promise<unknown> {
  return query(`UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2`, [notificationId, userId]);
}

/** Count of a user's unread notifications (social + legacy). */
export function getUnreadNotificationCount(userId: string): Promise<number> {
  return queryOne<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read = FALSE`,
    [userId]
  ).then((r) => Number(r?.n ?? 0));
}

// ── Admin-broadcast in-app notifications ─────────────────────────────────────
// Admins push a plain notification (title/body/optional link) into users' bells.
// Stored with type 'admin_message' — rendered by the legacy branch of the
// notifications UI (no actor). Distinct from the social notifications above.

/** Active (non-suspended) user ids, optionally filtered by role — broadcast targets. */
export function listActiveUserIds(role?: UserRole): Promise<{ id: string }[]> {
  const where = ["suspended = FALSE"];
  const params: unknown[] = [];
  if (role) {
    params.push(role);
    where.push(`role = $${params.length}`);
  }
  return query<{ id: string }>(`SELECT id FROM users WHERE ${where.join(" AND ")}`, params);
}

/** Count of active (non-suspended) users, optionally by role — for broadcast confirm UI. */
export function countActiveUsers(role?: UserRole): Promise<number> {
  const where = ["suspended = FALSE"];
  const params: unknown[] = [];
  if (role) {
    params.push(role);
    where.push(`role = $${params.length}`);
  }
  return queryOne<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM users WHERE ${where.join(" AND ")}`,
    params
  ).then((r) => Number(r?.n ?? 0));
}

/**
 * Insert one 'admin_message' notification per user id in a single statement.
 * Returns how many rows were created. Ids must reference existing users.
 */
export async function createAdminNotifications(
  userIds: string[],
  input: { title: string; body?: string; link?: string | null }
): Promise<number> {
  if (userIds.length === 0) return 0;
  const rows = await query<{ id: string }>(
    `INSERT INTO notifications (user_id, type, title, body, link)
     SELECT uid, 'admin_message', $2, $3, $4
       FROM UNNEST($1::uuid[]) AS uid
     RETURNING id`,
    [userIds, input.title, input.body ?? "", input.link ?? null]
  );
  return rows.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// Engagement: post likes + comment likes (migration 0014). All NEW functions.
// "Posts" are `content` rows. Inserts are idempotent (ON CONFLICT DO NOTHING).
// ═══════════════════════════════════════════════════════════════════════════

// ── Post likes ───────────────────────────────────────────────────────────────

/** Like a post. Idempotent. Returns true when a new like row was created. */
export function likePost(userId: string, postId: string): Promise<boolean> {
  return queryOne<{ id: string }>(
    `INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2)
     ON CONFLICT (user_id, post_id) DO NOTHING RETURNING id`,
    [userId, postId]
  ).then((r) => !!r);
}

/** Remove a post like. No-op if absent. */
export function unlikePost(userId: string, postId: string): Promise<unknown> {
  return query(`DELETE FROM post_likes WHERE user_id = $1 AND post_id = $2`, [userId, postId]);
}

export function isPostLiked(userId: string, postId: string): Promise<boolean> {
  return queryOne<{ x: number }>(
    `SELECT 1 AS x FROM post_likes WHERE user_id = $1 AND post_id = $2`,
    [userId, postId]
  ).then((r) => !!r);
}

export function getPostLikeCount(postId: string): Promise<number> {
  return queryOne<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM post_likes WHERE post_id = $1`,
    [postId]
  ).then((r) => Number(r?.n ?? 0));
}

/** Like counts for many posts at once → Map<postId, count> (avoids N+1 in feeds). */
export async function getPostLikeCounts(postIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (postIds.length === 0) return out;
  const rows = await query<{ post_id: string; n: string }>(
    `SELECT post_id, COUNT(*)::int AS n FROM post_likes
      WHERE post_id = ANY($1::uuid[]) GROUP BY post_id`,
    [postIds]
  );
  for (const r of rows) out.set(r.post_id, Number(r.n));
  return out;
}

/** Which of `postIds` the user has liked → Set<postId>. Empty set when signed out. */
export async function likedPostIdsFor(userId: string | null, postIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!userId || postIds.length === 0) return out;
  const rows = await query<{ post_id: string }>(
    `SELECT post_id FROM post_likes WHERE user_id = $1 AND post_id = ANY($2::uuid[])`,
    [userId, postIds]
  );
  for (const r of rows) out.add(r.post_id);
  return out;
}

// ── Comment likes ────────────────────────────────────────────────────────────

/** Like a comment. Idempotent. Returns true when a new like row was created. */
export function likeComment(userId: string, commentId: string): Promise<boolean> {
  return queryOne<{ id: string }>(
    `INSERT INTO comment_likes (user_id, comment_id) VALUES ($1, $2)
     ON CONFLICT (user_id, comment_id) DO NOTHING RETURNING id`,
    [userId, commentId]
  ).then((r) => !!r);
}

/** Remove a comment like. No-op if absent. */
export function unlikeComment(userId: string, commentId: string): Promise<unknown> {
  return query(`DELETE FROM comment_likes WHERE user_id = $1 AND comment_id = $2`, [userId, commentId]);
}

export function getCommentLikeCount(commentId: string): Promise<number> {
  return queryOne<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM comment_likes WHERE comment_id = $1`,
    [commentId]
  ).then((r) => Number(r?.n ?? 0));
}

/** Like counts for many comments at once → Map<commentId, count>. */
export async function getCommentLikeCounts(commentIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (commentIds.length === 0) return out;
  const rows = await query<{ comment_id: string; n: string }>(
    `SELECT comment_id, COUNT(*)::int AS n FROM comment_likes
      WHERE comment_id = ANY($1::uuid[]) GROUP BY comment_id`,
    [commentIds]
  );
  for (const r of rows) out.set(r.comment_id, Number(r.n));
  return out;
}

/** Which of `commentIds` the user has liked → Set<commentId>. */
export async function likedCommentIdsFor(userId: string | null, commentIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!userId || commentIds.length === 0) return out;
  const rows = await query<{ comment_id: string }>(
    `SELECT comment_id FROM comment_likes WHERE user_id = $1 AND comment_id = ANY($2::uuid[])`,
    [userId, commentIds]
  );
  for (const r of rows) out.add(r.comment_id);
  return out;
}

/** Comment count for many posts at once → Map<postId, count> (feed engagement signal). */
export async function getCommentCounts(postIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (postIds.length === 0) return out;
  const rows = await query<{ post_id: string; n: string }>(
    `SELECT post_id, COUNT(*)::int AS n FROM comments
      WHERE post_id = ANY($1::uuid[]) GROUP BY post_id`,
    [postIds]
  );
  for (const r of rows) out.set(r.post_id, Number(r.n));
  return out;
}

// ── Follow-graph helpers + profile tab data ─────────────────────────────────

/** Which of `ids` the given user follows → Set (batch, for feed follow buttons). */
export async function followingIdsFor(userId: string | null, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!userId || ids.length === 0) return out;
  const rows = await query<{ following_id: string }>(
    `SELECT following_id FROM follows WHERE follower_id = $1 AND following_id = ANY($2::uuid[])`,
    [userId, ids]
  );
  for (const r of rows) out.add(r.following_id);
  return out;
}

export interface PublicUserRow {
  id: string;
  display_name: string | null;
  handle: string | null;
  name: string | null;
  avatar: string | null;
  bio: string | null;
}

const PUBLIC_USER_COLS = `u.id, u.display_name, u.handle, u.name, u.avatar, u.bio`;

/** Users who follow `userId`, newest first. */
export function listFollowers(userId: string, limit = 100): Promise<PublicUserRow[]> {
  return query<PublicUserRow>(
    `SELECT ${PUBLIC_USER_COLS}
       FROM follows f JOIN users u ON u.id = f.follower_id
      WHERE f.following_id = $1 AND u.suspended = FALSE
      ORDER BY f.created_at DESC LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 200)]
  );
}

/** Users `userId` follows, newest first. */
export function listFollowing(userId: string, limit = 100): Promise<PublicUserRow[]> {
  return query<PublicUserRow>(
    `SELECT ${PUBLIC_USER_COLS}
       FROM follows f JOIN users u ON u.id = f.following_id
      WHERE f.follower_id = $1 AND u.suspended = FALSE
      ORDER BY f.created_at DESC LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 200)]
  );
}

export interface UserCommentRow {
  id: string;
  content: string;
  created_at: Date;
  post_id: string;
  post_title: string;
  post_slug: string;
}

/** A user's own comments (for the profile "Replies" tab), newest first, on published posts. */
export function listCommentsByUser(userId: string, limit = 50): Promise<UserCommentRow[]> {
  return query<UserCommentRow>(
    `SELECT cm.id, cm.content, cm.created_at, cm.post_id, ct.title AS post_title, ct.slug AS post_slug
       FROM comments cm JOIN content ct ON ct.id = cm.post_id
      WHERE cm.user_id = $1 AND ct.status = 'published'
      ORDER BY cm.created_at DESC LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 100)]
  );
}

/** Published posts a user has liked (profile "Likes" tab), newest-liked first. */
export function listLikedPostsByUser(userId: string, limit = 50): Promise<ContentWithCreator[]> {
  return query<ContentWithCreator>(
    `SELECT c.*, u.handle AS creator_handle, u.display_name AS creator_name,
            u.avatar AS creator_avatar, u.verified AS creator_verified
       FROM post_likes pl
       JOIN content c ON c.id = pl.post_id
       JOIN users u ON u.id = c.creator_id
      WHERE pl.user_id = $1 AND c.status = 'published'
      ORDER BY pl.created_at DESC LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 100)]
  );
}
