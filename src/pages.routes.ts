import type { Express } from 'express';
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
export function registerPageRoutes(app: Express, { repo, now }: Pick<NotesRouteDeps, 'repo' | 'now'>) {
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
  app.get('/n/:code', (req, res) => {
    const { code } = req.params;
    const meta = repo.meta(code, now());
    if (!meta) {
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
      sendPage(res, 200, {
        tab: 'open',
        title: 'Someone sent you a note',
        card: waitingCard(code, meta.views_left, meta.expires_at, secondsLeft),
        aside: noteAside(),
      });
    }
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
