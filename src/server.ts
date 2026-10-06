import { resolve } from 'node:path';
import { createApp, systemNow } from './app.js';
import { startCleanup } from './cleanup.js';
import { openDb } from './db.js';
import { createNotesRepo } from './notes.repo.js';

// Logs go to stdout/stderr, which the host (Render, Docker, a terminal) collects and timestamps.
// They never include note content, note codes, keys, tokens or passwords.
const log = (line: string) => console.log(`[tiny-notes] ${line}`);
const fail = (line: string, err: unknown): never => {
  console.error(`[tiny-notes] ${line}`);
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
};

// Anything that slips through still leaves a clear last line before the process stops.
process.on('uncaughtException', (err) => fail('fatal: uncaught exception', err));
process.on('unhandledRejection', (err) => fail('fatal: unhandled promise rejection', err));

const port = Number(process.env.PORT ?? 3000);
const tursoUrl = process.env.TURSO_DATABASE_URL || undefined;
// With TURSO_DATABASE_URL set, notes live in Turso. Otherwise they go in a local SQLite file.
const localFile = process.env.NOTES_DB ?? resolve(import.meta.dirname, '../data/notes.db');
const trustProxy = Number(process.env.TRUST_PROXY ?? 0);

// The settings in effect, so a wrong or missing one is visible at a glance. Secrets are
// reported only as set or not set.
log(`starting on node ${process.version}`);
log(`database: ${tursoUrl ? `Turso at ${new URL(tursoUrl).host}` : `local file ${localFile}`}`);
log(`TURSO_AUTH_TOKEN: ${process.env.TURSO_AUTH_TOKEN ? 'set' : 'not set'}`);
log(`SITE_URL: ${process.env.SITE_URL ?? 'not set (links use the request host)'}`);
log(`TRUST_PROXY: ${trustProxy}${trustProxy ? '' : ' (behind a proxy, every visitor will share one rate limit)'}`);
log(`analytics page: ${process.env.ANALYTICS_PASSWORD ? 'on' : 'off (ANALYTICS_PASSWORD not set)'}`);

const connectStarted = Date.now();
const db = await openDb(tursoUrl ?? `file:${localFile}`, process.env.TURSO_AUTH_TOKEN || undefined).catch(
  (err) => fail('fatal: could not open the database. Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, or that the NOTES_DB folder is writable.', err),
);
log(`database ready in ${Date.now() - connectStarted} ms`);

const stopCleanup = startCleanup(createNotesRepo(db), systemNow, log);
// SITE_URL has no trailing slash, e.g. https://notes.example.com
// TRUST_PROXY is the number of reverse proxies in front of the app (1 behind nginx).
const app = createApp({
  db,
  log,
  siteUrl: process.env.SITE_URL,
  trustProxy,
  analyticsPassword: process.env.ANALYTICS_PASSWORD || undefined,
});

const server = app.listen(port, () => log(`listening on port ${port}`));
server.on('error', (err) => fail(`fatal: could not listen on port ${port}`, err));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log(`${signal} received, shutting down`);
    stopCleanup();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
