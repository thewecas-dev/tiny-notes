import { resolve } from 'node:path';
import express, { type Express } from 'express';
import { generateCode as defaultGenerateCode } from './code.js';
import type { Db } from './db.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { createNotesRepo } from './notes.repo.js';
import { registerNotesRoutes } from './notes.routes.js';
import { registerPageRoutes } from './pages.routes.js';
import { rateLimit, type Limit } from './rate-limit.js';
import { MAX_BODY_BYTES } from './validation.js';

export interface AppDeps {
  db: Db;
  /** Current time in unix seconds. */
  now?: () => number;
  log?: (line: string) => void;
  generateCode?: () => string;
  /** Public origin used in canonical URLs, share links and the sitemap. */
  siteUrl?: string;
  /** Number of reverse proxies in front of the app, so the real client IP is used. */
  trustProxy?: number;
  /** Per-client limits. `create` covers new notes; `requests` covers every note request. */
  limits?: { create?: Limit; requests?: Limit };
}

const DEFAULT_LIMITS = {
  create: { limit: 20, windowSeconds: 600 },
  requests: { limit: 120, windowSeconds: 60 },
};

export const systemNow = () => Math.floor(Date.now() / 1000);

export function createApp({
  db,
  now = systemNow,
  log = console.log,
  generateCode = defaultGenerateCode,
  siteUrl,
  trustProxy = 0,
  limits = {},
}: AppDeps): Express {
  const app = express();
  const repo = createNotesRepo(db);
  app.disable('x-powered-by');
  app.set('siteUrl', siteUrl);
  app.set('trust proxy', trustProxy);

  // Logs the route pattern, not the URL, so neither note codes nor content reach the log.
  app.use((req, res, next) => {
    const started = performance.now();
    res.on('finish', () => {
      const route = (req.route as { path?: string } | undefined)?.path ?? '-';
      const ms = (performance.now() - started).toFixed(1);
      log(`${req.method} ${route} ${res.statusCode} ${ms}ms`);
    });
    next();
  });

  app.use('/notes', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Limits run before the body is read and before any handler, so a refused request
  // costs nothing and never uses a view.
  app.use(['/notes', '/n'], rateLimit(limits.requests ?? DEFAULT_LIMITS.requests, now));
  app.post('/notes', rateLimit(limits.create ?? DEFAULT_LIMITS.create, now));
  app.use(express.json({ limit: MAX_BODY_BYTES }));

  registerNotesRoutes(app, { repo, now, generateCode });
  registerPageRoutes(app, { repo, now });
  app.use(express.static(resolve(import.meta.dirname, '../public')));

  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
}
