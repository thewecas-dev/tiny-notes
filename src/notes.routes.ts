import type { Express } from 'express';
import { ApiError, notFound } from './errors.js';
import type { NotesRepo } from './notes.repo.js';
import { parseCreateBody, type CreateInput } from './validation.js';

const MAX_CODE_ATTEMPTS = 3;

const toIso = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toISOString().replace('.000Z', 'Z');

export interface NotesRouteDeps {
  repo: NotesRepo;
  now: () => number;
  generateCode: () => string;
}

/** Stores a note under a fresh code. Shared by the JSON API and the HTML form. */
export function createNote(
  { repo, now, generateCode }: NotesRouteDeps,
  { content, maxViews, expiresIn }: CreateInput,
) {
  const createdAt = now();
  const expiresAt = createdAt + expiresIn;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCode();
    if (repo.insert({ code, content, viewsLeft: maxViews, expiresAt, createdAt })) {
      return { code, viewsLeft: maxViews, expiresAt };
    }
  }
  throw new ApiError(500, 'internal_error', 'Unexpected server error.');
}

export function registerNotesRoutes(app: Express, deps: NotesRouteDeps) {
  const { repo, now } = deps;

  app.post('/notes', (req, res) => {
    const note = createNote(deps, parseCreateBody(req.body));
    res
      .status(201)
      .json({ code: note.code, views_left: note.viewsLeft, expires_at: toIso(note.expiresAt) });
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
