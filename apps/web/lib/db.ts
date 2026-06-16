import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Single shared SQLite connection. Holds creators, content, per-payment
 * earnings, the live transaction feed, and Guardian policies.
 *
 * SQLite keeps the hackathon stack zero-config; the schema maps cleanly to
 * Postgres if you graduate to Vercel Postgres later.
 */
let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  const file = process.env.DATABASE_PATH
    ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
    : path.resolve(process.cwd(), "linepay.db");
  _db = new Database(file);
  _db.pragma("journal_mode = WAL");
  migrate(_db);
  return _db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS creators (
      id            TEXT PRIMARY KEY,
      handle        TEXT UNIQUE NOT NULL,
      display_name  TEXT NOT NULL,
      wallet        TEXT NOT NULL,
      verified      INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content (
      id              TEXT PRIMARY KEY,
      creator_id      TEXT NOT NULL REFERENCES creators(id),
      kind            TEXT NOT NULL,            -- 'article' | 'novel_chapter'
      title           TEXT NOT NULL,
      summary         TEXT NOT NULL DEFAULT '',
      tags            TEXT NOT NULL DEFAULT '', -- comma separated
      body            TEXT NOT NULL,
      line_count      INTEGER NOT NULL,
      price_per_line  TEXT NOT NULL,            -- USDC base units
      free_lines      INTEGER NOT NULL DEFAULT 3,
      series          TEXT,                     -- novel series slug
      chapter_no      INTEGER,                  -- novel ordering
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id              TEXT PRIMARY KEY,
      content_id      TEXT NOT NULL REFERENCES content(id),
      creator_id      TEXT NOT NULL REFERENCES creators(id),
      payer           TEXT NOT NULL,
      payer_kind      TEXT NOT NULL DEFAULT 'agent', -- 'agent' | 'human'
      line_start      INTEGER NOT NULL,
      line_end        INTEGER NOT NULL,
      line_count      INTEGER NOT NULL,
      amount          TEXT NOT NULL,            -- total USDC base units
      creator_amount  TEXT NOT NULL,
      platform_amount TEXT NOT NULL,
      referrer_amount TEXT NOT NULL,
      tx_hash         TEXT NOT NULL,
      batch_id        TEXT,
      content_hash    TEXT NOT NULL,
      simulated       INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS policies (
      id          TEXT PRIMARY KEY,
      owner       TEXT NOT NULL,
      json        TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_content_creator ON content(creator_id);
    CREATE INDEX IF NOT EXISTS idx_payments_creator ON payments(creator_id);
    CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);

    -- Off-chain blob store for the on-chain marketplace. Holds the AES-256-GCM
    -- ciphertext of published content when Pinata/IPFS is not configured; the
    -- pseudo-CID (local://sha256) is what gets written on-chain. Reveal is gated
    -- by an on-chain hasAccess check (see app/api/reveal).
    CREATE TABLE IF NOT EXISTS ipfs_blobs (
      cid         TEXT PRIMARY KEY,
      ciphertext  TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'agent-skill',
      created_at  INTEGER NOT NULL
    );
  `);
}
