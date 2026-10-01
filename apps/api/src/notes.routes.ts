import type { Express } from 'express';
import { ApiError, notFound } from './errors.js';
import type { NotesRepo } from './notes.repo.js';
import { parseCreateBody } from './validation.js';

const MAX_CODE_ATTEMPTS = 3;

const toIso = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toISOString().replace('.000Z', 'Z');

export interface NotesRouteDeps {
  repo: NotesRepo;
  now: () => number;
  generateCode: () => string;
}

export function registerNotesRoutes(app: Express, { repo, now, generateCode }: NotesRouteDeps) {
  app.post('/notes', (req, res) => {
    const { content, maxViews, expiresIn } = parseCreateBody(req.body);
    const createdAt = now();
    const expiresAt = createdAt + expiresIn;

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = generateCode();
      if (repo.insert({ code, content, viewsLeft: maxViews, expiresAt, createdAt })) {
        res.status(201).json({ code, views_left: maxViews, expires_at: toIso(expiresAt) });
        return;
      }
    }
    throw new ApiError(500, 'internal_error', 'Unexpected server error.');
  });

  app.get('/notes/:code', (req, res) => {
    const note = repo.consume(req.params.code, now());
    if (!note) throw notFound();
    res.json({ content: note.content, views_left: note.views_left });
  });

  app.get('/notes/:code/meta', (req, res) => {
    const meta = repo.meta(req.params.code, now());
    if (!meta) throw notFound();
    res.json({
      views_left: meta.views_left,
      expires_at: toIso(meta.expires_at),
      created_at: toIso(meta.created_at),
    });
  });
}
