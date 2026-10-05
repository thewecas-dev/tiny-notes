# Tiny Notes

Notes that delete themselves. Store a piece of text, get a short code, and the note is deleted after a set number of views or a set time, whichever comes first. The full requirement is in [req.md](req.md).

One Node + Express process serves both the JSON API and the web pages. Pages are rendered on the server; there is no frontend build.

Notes written on the site are **end-to-end encrypted**: the browser encrypts them before sending, and the server stores only ciphertext it has no key for.

## Layout

| Path | What |
| --- | --- |
| `src/server.ts`, `src/app.ts` | Entry point and Express app factory |
| `src/notes.routes.ts`, `src/notes.repo.ts` | JSON API and the SQLite queries (`better-sqlite3`) |
| `src/pages.routes.ts`, `src/views.ts` | HTML pages, `robots.txt`, `sitemap.xml` |
| `public/crypto.js` | The encryption: AES-256-GCM via the browser's Web Crypto |
| `public/app.js` | Page behaviour: encrypts and sends a note, fetches and decrypts one, live readouts |
| `public/` (rest) | Stylesheet, fonts, logo and preview image |
| `test/` | API and page tests |

## Run

```sh
npm install
npm run dev      # http://localhost:3000, restarts on change
npm test
npm run build && npm start
```

Environment variables:

| Name | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `NOTES_DB` | `data/notes.db` | SQLite file |
| `SITE_URL` | request host | Public origin without a trailing slash, e.g. `https://notes.example.com`. **Set this in production**: canonical URLs, share links and the sitemap use it |

## Pages

| Path | Purpose | Indexed |
| --- | --- | --- |
| `GET /` | Home: write a note, how it works | Yes |
| `GET /open` | Find a note from a pasted link (parsed in the browser, never sent) | No |
| `GET /n/{code}` | Note status. Never uses a view | No |

Share links look like `https://host/n/aB3xK9pQ#<key>`. Creating and revealing go through the JSON API from `public/app.js`.

## End-to-end encryption

1. When the page opens, the browser generates a random 256-bit key.
2. On submit it encrypts the note with AES-256-GCM (fresh random IV each time) and posts `base64url(iv + ciphertext + tag)` as `content`.
3. The key is placed after the `#` in the share link. Browsers do not send the fragment in requests, so the key never reaches the server, its logs or the database.
4. The recipient's browser fetches the ciphertext and decrypts it with the key from the link.

What this means:

- The server, its operators, and anyone with the database or a backup hold only ciphertext.
- A lost link cannot be recovered: nobody else ever had the key.
- The site needs JavaScript and a secure context (HTTPS, or `localhost` in development).
- The page's own code does the encrypting, so users trust the server to deliver honest code. A strict Content-Security-Policy (`default-src 'self'`) rules out inline and third-party scripts.
- The JSON API itself stores whatever string it is given. API clients that want the same protection must encrypt before calling it; `public/crypto.js` is the reference.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/notes` | Create a note. Body: `content`, optional `max_views` (1–100, default 1) and `expires_in` seconds (60–604800, default 86400) |
| `GET` | `/notes/{code}` | Read the content. Uses one view |
| `GET` | `/notes/{code}/meta` | Views left and timestamps. Uses nothing |

Errors are JSON: `{ "error": "<code>", "message": "<text>" }`.

## SEO

- The home page is fully rendered HTML with a title, meta description, canonical URL, Open Graph and Twitter tags, and `WebApplication` structured data.
- `robots.txt` and `sitemap.xml` list the home page only.
- Every other page sends `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`, so note links never reach search results.
- The social preview image is `public/og.png` (1200×630) and the logo is `public/favicon.svg`. Both are exported from the Figma file "Tiny Notes — Brand".

## Notes on the implementation

- **Atomic reads**: one `UPDATE ... WHERE views_left > 0 AND expires_at > ? RETURNING`, plus the delete, in a single transaction (`src/notes.repo.ts`).
- **Size limit**: a JSON request body is capped at 102,400 bytes, so the largest `content` over the API is slightly under 100 KB. Encryption and base64 add about a third, so the site limits a note to 75 KB of text.
- **Logs**: the request log records the route pattern, never the URL or body, so neither codes nor content are logged.
- **Templates**: `src/views.ts` builds pages from template strings; every dynamic value is HTML-escaped.
