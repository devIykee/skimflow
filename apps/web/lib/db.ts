import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Single shared Postgres pool for the server. Holds users (creators/admins),
 * content + chunks, the payment ledger, payouts, the admin event stream,
 * agent sessions, and async export jobs.
 *
 * All monetary columns are NUMERIC(18,6) USDC. `pg` returns NUMERIC as a
 * string by default, which we keep (lossless) — see lib/money.ts for math.
 *
 * Set DATABASE_URL (e.g. postgres://user:pass@host:5432/linepay). Locally a
 * docker Postgres works; in production use a managed instance.
 */
let _pool: Pool | null = null;

/**
 * Cache the pool on globalThis. In dev, Next.js Fast Refresh re-evaluates this
 * module on every edit; without this cache each reload would create a NEW Pool
 * while the old one keeps its server connections open, quickly exhausting a
 * connection-limited pooler (e.g. Supabase session mode caps at ~15 clients →
 * `EMAXCONNSESSION`, and every query then blocks waiting for a free slot).
 */
const _g = globalThis as unknown as { __linepayPgPool?: Pool };

/**
 * Decide TLS for the connection. Managed Postgres (Supabase, Neon, RDS,
 * Render) require TLS; local Postgres usually has it off. We enable TLS when
 * the URL asks for it (sslmode=require / PGSSL=require) OR the host is a known
 * managed provider, and force it off for localhost. `rejectUnauthorized:false`
 * accepts the provider's chain without bundling a CA (fine for these hosts).
 */
function resolveSsl(connectionString: string): { rejectUnauthorized: boolean } | undefined {
  if (process.env.PGSSL === "disable") return undefined;
  let host = "";
  try {
    host = new URL(connectionString).hostname;
  } catch {
    /* leave host empty */
  }
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLocal && process.env.PGSSL !== "require") return undefined;
  const managed = /supabase\.(co|com|net)|pooler\.|neon\.tech|render\.com|rds\.amazonaws\.com/.test(
    host
  );
  if (
    process.env.PGSSL === "require" ||
    /sslmode=require/.test(connectionString) ||
    managed
  ) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

/** Remove sslmode (and libpq-compat) query params; TLS is set via the ssl option. */
function stripSslMode(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    u.searchParams.delete("sslmode");
    u.searchParams.delete("uselibpqcompat");
    return u.toString();
  } catch {
    return connectionString;
  }
}

export function pool(): Pool {
  if (_pool) return _pool;
  if (_g.__linepayPgPool) {
    _pool = _g.__linepayPgPool;
    return _pool;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Point it at a Postgres instance, e.g. " +
        "postgres://postgres:postgres@localhost:5432/linepay"
    );
  }
  const ssl = resolveSsl(connectionString);
  _pool = new Pool({
    // Strip any `sslmode` from the URL: newer pg treats sslmode=require as
    // verify-full, which rejects managed providers' self-signed chains and
    // overrides the `ssl` option below. We control TLS solely via `ssl`.
    connectionString: stripSslMode(connectionString),
    // Keep well under a pooler's client cap (Supabase session mode ≈ 15).
    max: Number(process.env.PG_POOL_MAX ?? 8),
    // Return idle connections to the pooler quickly so they don't pile up.
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 10_000),
    // Fail fast instead of hanging for tens of seconds when no slot is free.
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 10_000),
    ssl,
  });
  // A pooler can drop idle clients; without a handler the error is unhandled
  // and can crash the process. Swallow it — the pool re-establishes on demand.
  _pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
  });
  _g.__linepayPgPool = _pool;
  return _pool;
}

/**
 * Transient connection failures we should retry rather than surface. These come
 * from the NETWORK/DNS layer (e.g. WSL2's external resolvers intermittently
 * returning EAI_AGAIN, or a pooler dropping a half-open socket), not from SQL.
 * They happen while *acquiring* a connection, before any statement runs, so a
 * retry never re-executes a query.
 */
const TRANSIENT_CONN_CODES = new Set([
  "EAI_AGAIN", // temporary DNS resolution failure
  "ETIMEDOUT",
  "ENOTFOUND",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);
function isTransientConnError(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  if (code && TRANSIENT_CONN_CODES.has(code)) return true;
  const msg = String((e as { message?: string })?.message ?? "");
  return /connection timeout|Connection terminated|timeout expired|connection terminated unexpectedly/i.test(
    msg
  );
}

/**
 * Acquire a pooled client, retrying transient connection errors with a short
 * backoff. SQL/auth errors are NOT retried (they're deterministic). Bounds the
 * worst case to ~4 quick attempts so a flaky resolver doesn't fail the whole
 * `npm run up` (migrate/seed) on the first DNS blip.
 */
async function acquire(): Promise<PoolClient> {
  const attempts = Number(process.env.PG_CONNECT_RETRIES ?? 5);
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await pool().connect();
    } catch (e) {
      lastErr = e;
      if (!isTransientConnError(e) || i === attempts) throw e;
      // 400, 800, 1200, 1500ms — rides through a multi-second DNS burst.
      await new Promise((r) => setTimeout(r, Math.min(i * 400, 1500)));
    }
  }
  throw lastErr;
}

/** Typed query helper. Returns rows only. Connection acquisition is retried. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = []
): Promise<T[]> {
  const client = await acquire();
  try {
    const res = await client.query<T>(text, params as unknown[]);
    return res.rows;
  } finally {
    client.release();
  }
}

/** Query expecting a single row (or undefined). */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = []
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

/** Run a function inside a transaction, rolling back on throw. */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await acquire();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

const MIGRATIONS_DIR = path.resolve(process.cwd(), "db/migrations");

/**
 * Apply every .sql file in db/migrations in lexical order exactly once,
 * tracking applied files in a _migrations table. Idempotent — safe to run on
 * every deploy. Invoked by `npm run db:migrate`.
 */
export async function runMigrations(): Promise<{ applied: string[] }> {
  await query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    const done = await queryOne<{ name: string }>(
      `SELECT name FROM _migrations WHERE name = $1`,
      [file]
    );
    if (done) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    await tx(async (client) => {
      await client.query(sql);
      await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
    });
    applied.push(file);
  }
  return { applied };
}

/** Liveness probe for the admin health panel. Returns latency in ms. */
export async function dbPing(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await pool().query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}
