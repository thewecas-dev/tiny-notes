import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient, type Client } from '@libsql/client';

export type Db = Client;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS notes (
    code       TEXT PRIMARY KEY,
    content    TEXT NOT NULL,
    views_left INTEGER NOT NULL CHECK (views_left >= 0),
    expires_at INTEGER NOT NULL, -- unix seconds, UTC
    created_at INTEGER NOT NULL  -- unix seconds, UTC
  )`,
  'CREATE INDEX IF NOT EXISTS idx_notes_expires_at ON notes (expires_at)',

  // Analytics. One row per note, holding numbers only: never content, keys, or who sent it.
  `CREATE TABLE IF NOT EXISTS note_stats (
    code            TEXT PRIMARY KEY,   -- replaced with a random value once the note is gone
    created_at      INTEGER NOT NULL,
    text_bytes      INTEGER NOT NULL,   -- size of the text, estimated from the encrypted size
    max_views       INTEGER NOT NULL,
    expires_in      INTEGER NOT NULL,   -- lifetime chosen, in seconds
    views_used      INTEGER NOT NULL DEFAULT 0,
    link_opens      INTEGER NOT NULL DEFAULT 0,
    first_viewed_at INTEGER,
    last_viewed_at  INTEGER,
    ended_at        INTEGER,
    end_reason      TEXT                -- 'viewed' (all views used) or 'expired'
  )`,
  'CREATE INDEX IF NOT EXISTS idx_note_stats_created_at ON note_stats (created_at)',
  // Things that are not tied to a live note, counted per day: dead_link_opens, rate_limited.
  `CREATE TABLE IF NOT EXISTS counters (
    day   TEXT NOT NULL,
    name  TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, name)
  )`,

  // Triggers keep note_stats in step with notes inside the same transaction, so the note
  // paths need no extra code or round trips and the two can never disagree.
  `CREATE TRIGGER IF NOT EXISTS note_stats_created AFTER INSERT ON notes BEGIN
    INSERT OR REPLACE INTO note_stats (code, created_at, text_bytes, max_views, expires_in)
    VALUES (NEW.code, NEW.created_at, MAX(0, length(NEW.content) * 3 / 4 - 28),
            NEW.views_left, NEW.expires_at - NEW.created_at);
  END`,
  `CREATE TRIGGER IF NOT EXISTS note_stats_viewed AFTER UPDATE OF views_left ON notes BEGIN
    UPDATE note_stats
    SET views_used = views_used + 1,
        first_viewed_at = COALESCE(first_viewed_at, CAST(strftime('%s', 'now') AS INTEGER)),
        last_viewed_at = CAST(strftime('%s', 'now') AS INTEGER)
    WHERE code = NEW.code;
  END`,
  `CREATE TRIGGER IF NOT EXISTS note_stats_ended AFTER DELETE ON notes BEGIN
    UPDATE note_stats
    SET end_reason = CASE WHEN OLD.views_left = 0 THEN 'viewed' ELSE 'expired' END,
        ended_at = CASE WHEN OLD.views_left = 0 THEN CAST(strftime('%s', 'now') AS INTEGER) ELSE OLD.expires_at END,
        code = 'gone-' || lower(hex(randomblob(8)))
    WHERE code = OLD.code;
  END`,
];

/**
 * `url` is a Turso database (libsql://...), a local SQLite file (file:path) or `:memory:`.
 * The same SQL runs against all three.
 */
export async function openDb(url: string, authToken?: string): Promise<Db> {
  if (url.startsWith('file:')) mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });
  const db = createClient({ url, authToken });
  await db.batch(SCHEMA, 'write');
  return db;
}
