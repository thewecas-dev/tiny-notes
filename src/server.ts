import { resolve } from 'node:path';
import { createApp, systemNow } from './app.js';
import { startCleanup } from './cleanup.js';
import { openDb } from './db.js';
import { createNotesRepo } from './notes.repo.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.NOTES_DB ?? resolve(import.meta.dirname, '../data/notes.db');

const db = openDb(dbPath);
const stopCleanup = startCleanup(createNotesRepo(db), systemNow);
// SITE_URL has no trailing slash, e.g. https://notes.example.com
// TRUST_PROXY is the number of reverse proxies in front of the app (1 behind nginx).
const app = createApp({
  db,
  siteUrl: process.env.SITE_URL,
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
});

const server = app.listen(port, () => {
  console.log(`tiny-notes listening on http://localhost:${port}`);
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
