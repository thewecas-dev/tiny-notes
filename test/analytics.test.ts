import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain browser module, shared with the page
import { encrypt, newKey } from '../public/crypto.js';
import { createAnalytics } from '../src/analytics.js';
import { createApp, systemNow } from '../src/app.js';
import { openDb, type Db } from '../src/db.js';
import { createNotesRepo } from '../src/notes.repo.js';

// Real clock here: the triggers stamp view and end times with the database's own clock.
let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await openDb(':memory:');
  app = createApp({ db, log: () => {}, analyticsPassword: 'let-me-in' });
});

afterEach(() => db.close());

const create = async (body: object) => (await request(app).post('/notes').send(body)).body.code as string;
const stats = async () => (await db.execute('SELECT * FROM note_stats ORDER BY created_at, max_views')).rows;

describe('note stats', () => {
  it('follows a note from creation to its end without keeping its code or content', async () => {
    const sealed = await encrypt('hello world', newKey()); // 11 bytes of text
    const code = await create({ content: sealed, max_views: 2, expires_in: 3600 });

    let [row] = await stats();
    expect(row).toMatchObject({ code, text_bytes: 11, max_views: 2, expires_in: 3600, views_used: 0, ended_at: null });

    await request(app).get(`/n/${code}`); // opening the link is not a view
    await request(app).get(`/notes/${code}`);
    [row] = await stats();
    expect(row).toMatchObject({ views_used: 1, link_opens: 1, end_reason: null });
    expect(Number(row!.first_viewed_at) - Number(row!.created_at)).toBeLessThan(5);

    await request(app).get(`/notes/${code}`); // last view: the note is deleted
    [row] = await stats();
    expect(row).toMatchObject({ views_used: 2, end_reason: 'viewed' });
    expect(row!.code).toMatch(/^gone-[0-9a-f]{16}$/);
    expect(JSON.stringify(row)).not.toContain(code);
    expect(JSON.stringify(row)).not.toContain(sealed);
  });

  it('marks swept notes as expired and tells read from unread', async () => {
    const partly = await create({ content: 'a', max_views: 3, expires_in: 60 });
    await create({ content: 'b', max_views: 1, expires_in: 60 });
    await request(app).get(`/notes/${partly}`);

    await createNotesRepo(db).deleteExpired(systemNow() + 61);
    const rows = await stats();
    expect(rows.map((r) => [r.end_reason, r.views_used])).toEqual([
      ['expired', 0],
      ['expired', 1],
    ]);
    expect(rows.every((r) => Number(r.ended_at) - Number(r.created_at) === 60)).toBe(true);
  });
});

describe('report', () => {
  it('adds everything up', async () => {
    const analytics = createAnalytics(db);
    const one = await create({ content: 'x'.repeat(200), max_views: 1, expires_in: 300 });
    const five = await create({ content: 'x'.repeat(2000), max_views: 5, expires_in: 86_400 });
    await create({ content: 'x'.repeat(40), max_views: 1, expires_in: 7200 });
    await request(app).get(`/notes/${one}`);
    await request(app).get(`/notes/${five}`);
    await request(app).get('/n/nosuchno'); // a dead link

    const report = await analytics.report(systemNow());
    expect(report.totals).toMatchObject({
      notes: 3, last24h: 3, active: 2, reveals: 2, notesRevealed: 2, ended: 1, endedViewed: 1, deadLinkOpens: 1,
    });
    expect(report.textBytes).toMatchObject({ min: 2, median: 122, max: 1472 });
    expect(report.viewsAllowed).toMatchObject({ min: 1, median: 1, max: 5 });
    expect(report.firstView.max).toBeLessThan(5);
    expect(report.buckets.textBytes.map((b) => b.count)).toEqual([1, 1, 1, 0]);
    expect(report.buckets.expiresIn).toEqual([
      { label: '5 min', count: 1 }, { label: '1 hour', count: 0 }, { label: '1 day', count: 1 },
      { label: '7 days', count: 0 }, { label: 'Custom', count: 1 },
    ]);
    expect(report.daily).toHaveLength(30);
    expect(report.daily.at(-1)!.count).toBe(3);
    expect(report.hourly.reduce((a, b) => a + b)).toBe(3);
  });

  it('copes with no notes at all', async () => {
    const report = await createAnalytics(db).report(systemNow());
    expect(report.totals.notes).toBe(0);
    expect(report.firstView).toEqual({ min: null, median: null, avg: null, max: null });
  });
});

describe('analytics page', () => {
  const login = (password: string) => request(app).post('/analytics').type('form').send({ password });

  it('asks for the password first and shows no numbers until it is right', async () => {
    await create({ content: 'x' });

    const form = await request(app).get('/analytics');
    expect(form.status).toBe(200);
    expect(form.text).toContain('type="password"');
    expect(form.text).not.toContain('Notes created');

    const wrong = await login('nope');
    expect(wrong.status).toBe(401);
    expect(wrong.text).toContain('That password is not right.');
    expect(wrong.text).not.toContain('Notes created');

    const right = await login('let-me-in');
    expect(right.status).toBe(200);
    expect(right.text).toContain('Notes created');
    for (const res of [form, wrong, right]) {
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('returns the numbers as JSON to a client that asks for JSON', async () => {
    await create({ content: 'x' });
    const post = (password: string) =>
      request(app).post('/analytics').set('Accept', 'application/json').send({ password });

    const wrong = await post('nope');
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ error: 'wrong_password', message: expect.any(String) });

    const right = await post('let-me-in');
    expect(right.status).toBe(200);
    expect(right.body.totals.notes).toBe(1);
  });

  it('does not exist when no password is configured', async () => {
    const off = createApp({ db, log: () => {} });
    expect((await request(off).get('/analytics')).status).toBe(404);
    expect((await request(off).post('/analytics').type('form').send({ password: '' })).status).toBe(404);
  });

  it('allows only ten password attempts per ten minutes', async () => {
    for (let i = 0; i < 10; i++) expect((await login('guess')).status).toBe(401);
    expect((await login('let-me-in')).status).toBe(429);
  });

  it('is not linked from the site, the sitemap or robots.txt', async () => {
    for (const path of ['/', '/open', '/sitemap.xml', '/robots.txt']) {
      expect((await request(app).get(path)).text).not.toContain('analytics');
    }
  });

  it('counts rate-limited requests', async () => {
    const strict = createApp({ db, log: () => {}, limits: { create: { limit: 1, windowSeconds: 600 } } });
    await request(strict).post('/notes').send({ content: 'x' });
    await request(strict).post('/notes').send({ content: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 20)); // the count is written in the background
    expect((await createAnalytics(db).report(systemNow())).totals.rateLimited).toBe(1);
  });
});
