import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS notes (
    code       TEXT PRIMARY KEY,
    content    TEXT NOT NULL,
    views_left INTEGER NOT NULL CHECK (views_left >= 0),
    expires_at INTEGER NOT NULL, -- unix seconds, UTC
    created_at INTEGER NOT NULL  -- unix seconds, UTC
  );
  CREATE INDEX IF NOT EXISTS idx_notes_expires_at ON notes (expires_at);
`;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  // Rollback journal, not WAL: every committed row is in notes.db itself, so the one file
  // is the whole database. Set explicitly because a file created in WAL mode stays in it.
  db.pragma('journal_mode = DELETE');
  db.exec(SCHEMA);
  return db;
}
