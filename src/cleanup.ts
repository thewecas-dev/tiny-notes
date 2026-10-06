import type { NotesRepo } from './notes.repo.js';

export const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

/** Deletes expired rows on a timer. Returns a function that stops the job. */
export function startCleanup(
  repo: NotesRepo,
  now: () => number,
  log: (line: string) => void = () => {},
  intervalMs = CLEANUP_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    // A failed sweep (say, the database is briefly unreachable) must not take the server down.
    repo
      .deleteExpired(now())
      .then((removed) => removed && log(`cleanup: removed ${removed} expired ${removed === 1 ? 'note' : 'notes'}`))
      .catch((err) => log(`cleanup failed: ${err?.message}`));
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
