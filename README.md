# Tiny Notes

Notes that delete themselves. Store a piece of text, get a short code, and the note is deleted after a set number of views or a set time, whichever comes first. The full requirement is in [req.md](req.md).

## Layout

| Path | What |
| --- | --- |
| `apps/api` | Node + Express 5 + TypeScript API, SQLite via `better-sqlite3` |
| `apps/web` | Angular single-page UI (create a note, open a note, how it works) |

## Run

```sh
npm install
npm run dev      # API on http://localhost:3000, UI on http://localhost:4200
npm test         # API test suite (one test per acceptance criterion)
```

Production is a single process: the API serves the built UI.

```sh
npm run build
npm start        # http://localhost:3000
```

Environment variables: `PORT` (default `3000`), `NOTES_DB` (default `apps/api/data/notes.db`).

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/notes` | Create a note. Body: `content`, optional `max_views` (1–100, default 1) and `expires_in` seconds (60–604800, default 86400) |
| `GET` | `/notes/{code}` | Read the content. Uses one view |
| `GET` | `/notes/{code}/meta` | Views left and timestamps. Uses nothing |

Errors are JSON: `{ "error": "<code>", "message": "<text>" }`.

## Notes on the implementation

- **Atomic reads**: one `UPDATE ... WHERE views_left > 0 AND expires_at > ? RETURNING`, plus the delete, in a single transaction (`apps/api/src/notes.repo.ts`).
- **Size limit**: the request body is capped at 102,400 bytes, so the largest possible `content` is slightly under 100 KB once the JSON wrapper is counted.
- **Logs**: the request log records the route pattern, never the URL or body, so neither codes nor content are logged.
- **Share links** look like `https://host/#aB3xK9pQ`. The UI only calls `/meta` when a link is opened; a view is used only when the reader presses Reveal.
