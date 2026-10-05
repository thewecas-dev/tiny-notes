import type { Db } from './db.js';

export interface NewNote {
  code: string;
  content: string;
  viewsLeft: number;
  expiresAt: number;
  createdAt: number;
}

export interface ConsumedNote {
  content: string;
  views_left: number;
}

export interface NoteMeta {
  views_left: number;
  expires_at: number;
  created_at: number;
}

export type NotesRepo = ReturnType<typeof createNotesRepo>;

export function createNotesRepo(db: Db) {
  const insertStmt = db.prepare(
    'INSERT INTO notes (code, content, views_left, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const consumeStmt = db.prepare<[string, number], ConsumedNote>(
    `UPDATE notes SET views_left = views_left - 1
     WHERE code = ? AND views_left > 0 AND expires_at > ?
     RETURNING content, views_left`,
  );
  const deleteStmt = db.prepare('DELETE FROM notes WHERE code = ?');
  const metaStmt = db.prepare<[string, number], NoteMeta>(
    `SELECT views_left, expires_at, created_at FROM notes
     WHERE code = ? AND views_left > 0 AND expires_at > ?`,
  );
  const deleteExpiredStmt = db.prepare('DELETE FROM notes WHERE expires_at <= ?');

  // Check, decrement and delete happen in one transaction so a note is never over-served.
  const consumeTx = db.transaction((code: string, now: number) => {
    const row = consumeStmt.get(code, now);
    if (row && row.views_left === 0) deleteStmt.run(code);
    return row;
  });

  return {
    /** Returns false when the code is already taken. */
    insert(note: NewNote): boolean {
      try {
        insertStmt.run(note.code, note.content, note.viewsLeft, note.expiresAt, note.createdAt);
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return false;
        throw err;
      }
    },

    consume(code: string, now: number): ConsumedNote | undefined {
      return consumeTx(code, now);
    },

    meta(code: string, now: number): NoteMeta | undefined {
      return metaStmt.get(code, now);
    },

    /** Returns the number of rows removed. */
    deleteExpired(now: number): number {
      return deleteExpiredStmt.run(now).changes;
    },
  };
}
