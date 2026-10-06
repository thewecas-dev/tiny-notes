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
  return {
    /** Resolves to false when the code is already taken. */
    async insert(note: NewNote): Promise<boolean> {
      try {
        await db.execute({
          sql: 'INSERT INTO notes (code, content, views_left, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
          args: [note.code, note.content, note.viewsLeft, note.expiresAt, note.createdAt],
        });
        return true;
      } catch (err) {
        // The primary key is the only constraint an insert can break.
        if (String((err as { code?: string }).code).startsWith('SQLITE_CONSTRAINT')) return false;
        throw err;
      }
    },

    /**
     * Check, decrement and delete in one transaction, sent as a single round trip, so a
     * note is never over-served. The UPDATE alone decides who gets the note; the DELETE
     * only removes a row that has just reached zero.
     */
    async consume(code: string, now: number): Promise<ConsumedNote | undefined> {
      const [updated] = await db.batch(
        [
          {
            sql: `UPDATE notes SET views_left = views_left - 1
                  WHERE code = ? AND views_left > 0 AND expires_at > ?
                  RETURNING content, views_left`,
            args: [code, now],
          },
          { sql: 'DELETE FROM notes WHERE code = ? AND views_left = 0', args: [code] },
        ],
        'write',
      );
      const row = updated?.rows[0];
      return row && { content: String(row.content), views_left: Number(row.views_left) };
    },

    async meta(code: string, now: number): Promise<NoteMeta | undefined> {
      const { rows } = await db.execute({
        sql: `SELECT views_left, expires_at, created_at FROM notes
              WHERE code = ? AND views_left > 0 AND expires_at > ?`,
        args: [code, now],
      });
      const row = rows[0];
      return (
        row && {
          views_left: Number(row.views_left),
          expires_at: Number(row.expires_at),
          created_at: Number(row.created_at),
        }
      );
    },

    /** Resolves to the number of rows removed. */
    async deleteExpired(now: number): Promise<number> {
      const result = await db.execute({ sql: 'DELETE FROM notes WHERE expires_at <= ?', args: [now] });
      return result.rowsAffected;
    },
  };
}
