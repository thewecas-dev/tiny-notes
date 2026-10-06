import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type Express, type Response } from 'express';
import type { Analytics } from './analytics.js';
import { analyticsLogin, analyticsPage } from './analytics.view.js';
import { notFound } from './errors.js';
import type { NotesRouteDeps } from './notes.routes.js';
import {
  createFormCard,
  createdCard,
  goneCard,
  lookupCard,
  noteAside,
  sendPage,
  serverViewAside,
  siteOrigin,
  waitingCard,
} from './views.js';

// Pages only ever read note metadata. Creating and revealing go through the JSON API from
// public/app.js, which encrypts and decrypts in the browser.
export interface PageRouteDeps extends Pick<NotesRouteDeps, 'repo' | 'now'> {
  analytics: Analytics;
  analyticsPassword?: string;
}

const digest = (text: string) => createHash('sha256').update(text).digest();

export function registerPageRoutes(app: Express, { repo, now, analytics, analyticsPassword }: PageRouteDeps) {
  app.get('/', (req, res) => {
    sendPage(res, 200, {
      tab: 'write',
      canonical: `${siteOrigin(req)}/`,
      card: createFormCard(),
      aside: serverViewAside(),
    });
  });

  app.get('/open', (_req, res) => {
    sendPage(res, 200, { tab: 'open', title: 'Open a note', card: lookupCard(), aside: noteAside() });
  });

  // Viewing this page never uses a view, so link previews and prefetching are harmless.
  app.get('/n/:code', async (req, res) => {
    const { code } = req.params;
    const meta = await repo.meta(code, now());
    if (!meta) {
      await analytics.count('dead_link_opens').catch(() => {});
      sendPage(res, 404, { tab: 'open', title: 'Note not available', card: goneCard() });
      return;
    }
    const secondsLeft = meta.expires_at - now();
    if (req.query.created) {
      sendPage(res, 200, {
        tab: 'write',
        title: 'Your link is ready',
        card: createdCard(`${siteOrigin(req)}/n/${code}`, meta.views_left, secondsLeft),
        aside: noteAside(),
      });
    } else {
      await analytics.linkOpened(code).catch(() => {});
      sendPage(res, 200, {
        tab: 'open',
        title: 'Someone sent you a note',
        card: waitingCard(code, meta.views_left, meta.expires_at, secondsLeft),
        aside: noteAside(),
      });
    }
  });

  // Unlisted: no links point here, it is not in the sitemap, and it is never indexed or cached.
  // GET only ever shows the password form. The numbers are read from the database after the
  // password has been checked, and never before.
  const privately = (res: Response) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    return res;
  };

  app.get('/analytics', (_req, res) => {
    if (!analyticsPassword) throw notFound(); // not configured: the page does not exist
    privately(res).type('html').send(analyticsLogin());
  });

  app.post('/analytics', express.urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
    if (!analyticsPassword) throw notFound();
    const given = typeof req.body?.password === 'string' ? req.body.password : '';
    const wantsJson = req.accepts(['html', 'json']) === 'json';
    privately(res);

    if (!timingSafeEqual(digest(given), digest(analyticsPassword))) {
      const message = 'That password is not right.';
      if (wantsJson) res.status(401).json({ error: 'wrong_password', message });
      else res.status(401).type('html').send(analyticsLogin(message));
      return;
    }

    const report = await analytics.report(now());
    if (wantsJson) res.json(report);
    else res.type('html').send(analyticsPage(report, now()));
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text').send(`User-agent: *\nAllow: /\nSitemap: ${siteOrigin(req)}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', (req, res) => {
    res
      .type('xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${siteOrigin(req)}/</loc></url></urlset>\n`,
      );
  });
}
