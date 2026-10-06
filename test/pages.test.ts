import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain browser module, shared with the page
import { decrypt, encrypt, newKey } from '../public/crypto.js';
import { createApp } from '../src/app.js';
import { openDb, type Db } from '../src/db.js';

const SITE = 'https://notes.example.com';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await openDb(':memory:');
  app = createApp({ db, log: () => {}, siteUrl: SITE });
});

afterEach(() => db.close());

const createNote = async (content: string) =>
  (await request(app).post('/notes').send({ content })).body.code as string;

describe('SEO', () => {
  it('serves an indexable home page with complete metadata', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['x-robots-tag']).toBeUndefined();
    expect(res.text).toMatch(/<title>[^<]{30,65}<\/title>/);
    expect(res.text).toMatch(/<meta name="description" content="[^"]{110,160}">/);
    expect(res.text).toContain(`<link rel="canonical" href="${SITE}/">`);
    expect(res.text).toContain(`<meta property="og:url" content="${SITE}/">`);
    expect(res.text).toContain(`<meta property="og:image" content="${SITE}/og.png">`);
    expect(res.text).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect((await request(app).get('/og.png')).headers['content-type']).toBe('image/png');
    expect(res.text).not.toContain('noindex');
    expect(res.text.match(/<h1/g)).toHaveLength(1);

    const jsonLd = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(res.text)?.[1];
    expect(JSON.parse(jsonLd!)).toMatchObject({ '@type': 'WebApplication', url: `${SITE}/` });
  });

  it('serves robots.txt and a sitemap that lists only the home page', async () => {
    const robots = await request(app).get('/robots.txt');
    expect(robots.text).toContain(`Sitemap: ${SITE}/sitemap.xml`);

    const sitemap = await request(app).get('/sitemap.xml');
    expect(sitemap.headers['content-type']).toContain('xml');
    expect(sitemap.text.match(/<loc>/g)).toHaveLength(1);
    expect(sitemap.text).toContain(`<loc>${SITE}/</loc>`);
  });

  it('keeps note pages out of search results and caches', async () => {
    const res = await request(app).get(`/n/${await createNote('x')}`);

    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.text).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(res.text).not.toContain('rel="canonical"');
  });
});

describe('end-to-end encryption', () => {
  it('round-trips a note and rejects a wrong key or altered text', async () => {
    const key = newKey();
    expect(key).toMatch(/^[\w-]{43}$/);

    const secret = 'pässword 🔑\nline two';
    const sealed = await encrypt(secret, key);
    expect(sealed).not.toContain('line two');
    expect(await encrypt(secret, key)).not.toBe(sealed); // fresh IV every time
    expect(await decrypt(sealed, key)).toBe(secret);

    await expect(decrypt(sealed, newKey())).rejects.toThrow();
    const flipped = (sealed[20] === 'A' ? 'B' : 'A');
    await expect(decrypt(sealed.slice(0, 20) + flipped + sealed.slice(21), key)).rejects.toThrow();
  });

  it('never gives the server the note or the key', async () => {
    const key = newKey();
    const secret = 'correct-horse-battery-staple';
    const code = await createNote(await encrypt(secret, key));

    // Everything the server holds, and every page it renders for this note.
    const stored = JSON.stringify((await db.execute('SELECT * FROM notes')).rows);
    const pages = [
      (await request(app).get(`/n/${code}?created=1`)).text,
      (await request(app).get(`/n/${code}`)).text,
    ].join('');
    for (const seen of [stored, pages]) {
      expect(seen).not.toContain(secret);
      expect(seen).not.toContain(key);
    }

    // Only a holder of the key can turn what the API returns back into the note.
    const { content } = (await request(app).get(`/notes/${code}`)).body;
    expect(content).not.toContain(secret);
    expect(await decrypt(content, key)).toBe(secret);
  });

  it('fits the largest note the page allows under the server limit', async () => {
    const sealed = await encrypt('a'.repeat(75_000), newKey());
    const res = await request(app).post('/notes').send({ content: sealed, max_views: 100, expires_in: 604_800 });
    expect(res.status).toBe(201);
  });
});

describe('note pages', () => {
  it('shows the link page and the waiting page without using a view', async () => {
    const code = await createNote('sealed');

    const link = await request(app).get(`/n/${code}?created=1`);
    expect(link.text).toContain(`<span>${SITE}/n/${code}</span>`);

    for (let i = 0; i < 3; i++) {
      const waiting = await request(app).get(`/n/${code}`);
      expect(waiting.status).toBe(200);
      expect(waiting.text).toContain('1 view left');
      expect(waiting.text).toContain(`data-code="${code}"`);
    }

    expect((await request(app).get(`/notes/${code}`)).status).toBe(200);
    const gone = await request(app).get(`/n/${code}`);
    expect(gone.status).toBe(404);
    expect(gone.text).toContain('no longer available');
  });

  it('gives browsers an HTML 404 and API clients a JSON one', async () => {
    const html = await request(app).get('/nope').set('Accept', 'text/html');
    expect(html.status).toBe(404);
    expect(html.text).toContain('Page not found');

    const json = await request(app).get('/notes/nosuchno').set('Accept', 'text/html');
    expect(json.body.error).toBe('not_found');
  });
});
