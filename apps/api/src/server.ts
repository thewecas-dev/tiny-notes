import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp, systemNow } from './app.js';
import { startCleanup } from './cleanup.js';
import { openDb } from './db.js';
import { createNotesRepo } from './notes.repo.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.NOTES_DB ?? resolve(import.meta.dirname, '../data/notes.db');
const webDist = resolve(import.meta.dirname, '../../web/dist/web/browser');

const db = openDb(dbPath);
const stopCleanup = startCleanup(createNotesRepo(db), systemNow);
const app = createApp({ db, staticDir: existsSync(webDist) ? webDist : undefined });

const server = app.listen(port, () => {
  console.log(`tiny-notes api listening on http://localhost:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopCleanup();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
