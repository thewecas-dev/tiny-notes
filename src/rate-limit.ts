import type { RequestHandler } from 'express';
import { ApiError } from './errors.js';

/** At most `limit` requests per client per window. */
export interface Limit {
  limit: number;
  windowSeconds: number;
}

// ponytail: counters live in this process's memory, keyed by client IP. Fine for one
// process; if the app ever runs as several instances, move the counters to a shared store.
export function rateLimit({ limit, windowSeconds }: Limit, now: () => number): RequestHandler {
  const clients = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next) => {
    const time = now();
    // Keep the map from growing without bound when many different clients pass through.
    if (clients.size > 10_000) {
      for (const [ip, entry] of clients) if (entry.resetAt <= time) clients.delete(ip);
    }

    const ip = req.ip ?? 'unknown';
    let entry = clients.get(ip);
    if (!entry || entry.resetAt <= time) {
      entry = { count: 0, resetAt: time + windowSeconds };
      clients.set(ip, entry);
    }
    entry.count++;

    if (entry.count > limit) {
      const wait = entry.resetAt - time;
      res.setHeader('Retry-After', String(wait));
      next(new ApiError(429, 'rate_limited', `Too many requests. Try again in ${wait} seconds.`));
      return;
    }
    next();
  };
}
