import type { NotesRepo } from './notes.repo.js';

export const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

/** Deletes expired rows on a timer. Returns a function that stops the job. */
export function startCleanup(
  repo: NotesRepo,
  now: () => number,
  intervalMs = CLEANUP_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => repo.deleteExpired(now()), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
