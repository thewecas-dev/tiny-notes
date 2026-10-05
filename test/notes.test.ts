import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { CLEANUP_INTERVAL_MS, startCleanup } from '../src/cleanup.js';
import { openDb, type Db } from '../src/db.js';
import { createNotesRepo } from '../src/notes.repo.js';

const START = 1_790_000_000; // fixed unix seconds so expiry maths is exact

let db: Db;
let clock: number;
let logs: string[];
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(':memory:');
  clock = START;
  logs = [];
  app = createApp({ db, now: () => clock, log: (line) => logs.push(line) });
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const create = (body: object) => request(app).post('/notes').send(body);
const rowCount = () => (db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n;

/** A JSON body of exactly `bytes` bytes. */
function bodyOfSize(bytes: number): string {
  const wrapper = JSON.stringify({ content: '' });
  return JSON.stringify({ content: 'a'.repeat(bytes - wrapper.length) });
}

describe('POST /notes', () => {
  it('applies defaults when only content is sent', async () => {
    const res = await create({ content: 'db password: hunter2' });

    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(res.body.views_left).toBe(1);
    expect(res.body.expires_at).toBe(new Date((START + 86_400) * 1000).toISOString().replace('.000Z', 'Z'));
    expect(Object.keys(res.body).sort()).toEqual(['code', 'expires_at', 'views_left']);
  });

  it('ignores unknown fields', async () => {
    const res = await create({ content: 'hi', colour: 'blue' });
    expect(res.status).toBe(201);
  });

  it.each([0, 101, 'abc', 1.5, null])('rejects max_views = %j', async (max_views) => {
    const res = await create({ content: 'hi', max_views });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_field');
    expect(typeof res.body.message).toBe('string');
  });

  it.each([59, 604_801, '3600'])('rejects expires_in = %j', async (expires_in) => {
    const res = await create({ content: 'hi', expires_in });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_field');
  });

  it('accepts the range limits', async () => {
    expect((await create({ content: 'hi', max_views: 100, expires_in: 604_800 })).status).toBe(201);
    expect((await create({ content: 'hi', max_views: 1, expires_in: 60 })).status).toBe(201);
  });

  it.each([{}, { content: '' }, { content: '   \n\t' }, { content: 42 }, []])(
    'rejects content in %j',
    async (body) => {
      const res = await create(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_content');
    },
  );

  it('rejects malformed JSON', async () => {
    const res = await request(app)
      .post('/notes')
      .set('Content-Type', 'application/json')
      .send('{"content": ');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_json');
  });

  it('accepts a 100 KB body and rejects 100 KB + 1 byte', async () => {
    const send = (bytes: number) =>
      request(app).post('/notes').set('Content-Type', 'application/json').send(bodyOfSize(bytes));

    expect(Buffer.byteLength(bodyOfSize(102_400))).toBe(102_400);
    expect((await send(102_400)).status).toBe(201);

    const tooBig = await send(102_401);
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error).toBe('payload_too_large');
  });

  it('counts size in bytes, not characters', async () => {
    // 30,000 emoji are 30,000 characters but 120,000 bytes.
    const res = await create({ content: '🔥'.repeat(30_000) });
    expect(res.status).toBe(413);
  });

  it('retries on a code collision, then gives up with 500', async () => {
    const codes = ['aaaaaaaa', 'aaaaaaaa', 'bbbbbbbb'];
    const colliding = createApp({ db, now: () => clock, log: () => {}, generateCode: () => codes.shift() ?? 'aaaaaaaa' });

    expect((await request(colliding).post('/notes').send({ content: 'one' })).body.code).toBe('aaaaaaaa');
    expect((await request(colliding).post('/notes').send({ content: 'two' })).body.code).toBe('bbbbbbbb');

    const res = await request(colliding).post('/notes').send({ content: 'three' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
  });
});

describe('GET /notes/:code', () => {
  it('serves a 1-view note once, then 404', async () => {
    const { code } = (await create({ content: 'only once' })).body;

    const first = await request(app).get(`/notes/${code}`);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ content: 'only once', views_left: 0 });
    expect(rowCount()).toBe(0); // deleted in the same operation

    const second = await request(app).get(`/notes/${code}`);
    expect(second.status).toBe(404);
    expect(second.body.error).toBe('not_found');
  });

  it('serves a 3-view note exactly 3 times', async () => {
    const { code } = (await create({ content: 'thrice', max_views: 3 })).body;

    for (const left of [2, 1, 0]) {
      const res = await request(app).get(`/notes/${code}`);
      expect(res.status).toBe(200);
      expect(res.body.views_left).toBe(left);
    }
    expect((await request(app).get(`/notes/${code}`)).status).toBe(404);
  });

  it('returns 404 after expiry, before cleanup runs', async () => {
    const { code } = (await create({ content: 'short lived', max_views: 5, expires_in: 60 })).body;

    clock = START + 59;
    expect((await request(app).get(`/notes/${code}`)).status).toBe(200);

    clock = START + 61;
    expect(rowCount()).toBe(1); // still in the database
    expect((await request(app).get(`/notes/${code}`)).status).toBe(404);
    expect((await request(app).get(`/notes/${code}/meta`)).status).toBe(404);
  });

  it('gives identical 404s for unknown, expired and used-up notes', async () => {
    const used = (await create({ content: 'used' })).body.code;
    await request(app).get(`/notes/${used}`);
    const expired = (await create({ content: 'expired', expires_in: 60 })).body.code;
    clock = START + 120;

    const bodies = await Promise.all(
      ['nosuchno', used, expired].map(async (code) => (await request(app).get(`/notes/${code}`)).body),
    );
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it('20 simultaneous reads of a 1-view note give one 200 and nineteen 404s', async () => {
    const { code } = (await create({ content: 'race me' })).body;
    const server: Server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const responses = await Promise.all(
        Array.from({ length: 20 }, () => fetch(`http://127.0.0.1:${port}/notes/${code}`)),
      );
      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s === 404)).toHaveLength(19);
    } finally {
      server.close();
    }
  });
});

describe('GET /notes/:code/meta', () => {
  it('returns metadata without content and without consuming a view', async () => {
    const { code } = (await create({ content: 'peek', max_views: 2, expires_in: 3600 })).body;

    for (let i = 0; i < 3; i++) {
      const res = await request(app).get(`/notes/${code}/meta`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        views_left: 2,
        expires_at: new Date((START + 3600) * 1000).toISOString().replace('.000Z', 'Z'),
        created_at: new Date(START * 1000).toISOString().replace('.000Z', 'Z'),
      });
    }
    expect((await request(app).get(`/notes/${code}`)).body.views_left).toBe(1);
  });

  it('returns 404 for an unknown code', async () => {
    const res = await request(app).get('/notes/nosuchno/meta');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

describe('cleanup', () => {
  it('removes expired rows and keeps live ones', async () => {
    await create({ content: 'short', expires_in: 60 });
    await create({ content: 'long', expires_in: 3600 });
    const repo = createNotesRepo(db);

    clock = START + 61;
    expect(repo.deleteExpired(clock)).toBe(1);
    expect(rowCount()).toBe(1);
  });

  it('runs every 10 minutes', async () => {
    await create({ content: 'short', expires_in: 60 });
    vi.useFakeTimers();
    const stop = startCleanup(createNotesRepo(db), () => clock);

    clock = START + 61;
    vi.advanceTimersByTime(CLEANUP_INTERVAL_MS - 1);
    expect(rowCount()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(rowCount()).toBe(0);
    stop();
  });
});

describe('logging', () => {
  it('never writes note content or codes to the log', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const secret = 'correct-horse-battery-staple';

    const { code } = (await create({ content: secret, max_views: 2 })).body;
    await request(app).get(`/notes/${code}/meta`);
    await request(app).get(`/notes/${code}`);
    await create({ content: secret, max_views: 0 });
    await request(app).post('/notes').set('Content-Type', 'application/json').send(`{"content":"${secret}"`);

    const output = [...logs, ...consoleSpies.flatMap((spy) => spy.mock.calls.flat())].join('\n');
    expect(logs).toContain(logs.find((l) => l.startsWith('GET /notes/:code 200')));
    expect(output).not.toContain(secret);
    expect(output).not.toContain(code);
  });
});

describe('unknown routes', () => {
  it('returns the JSON error shape', async () => {
    const res = await request(app).delete('/notes/whatever');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found', message: expect.any(String) });
  });
});

describe('rate limiting', () => {
  const limited = (limits: Parameters<typeof createApp>[0]['limits']) =>
    createApp({ db, now: () => clock, log: () => {}, limits });

  it('caps note creation per client, then allows it again after the window', async () => {
    const strict = limited({ create: { limit: 2, windowSeconds: 600 } });
    const post = () => request(strict).post('/notes').send({ content: 'x' });

    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);

    const refused = await post();
    expect(refused.status).toBe(429);
    expect(refused.body.error).toBe('rate_limited');
    expect(refused.headers['retry-after']).toBe('600');
    expect(rowCount()).toBe(2); // the refused note was not stored

    clock = START + 600;
    expect((await post()).status).toBe(201);
  });

  it('never uses a view when a read is refused', async () => {
    const strict = limited({ requests: { limit: 2, windowSeconds: 60 } });
    const { code } = (await request(strict).post('/notes').send({ content: 'still here' })).body;
    await request(strict).get(`/notes/${code}/meta`);

    expect((await request(strict).get(`/notes/${code}`)).status).toBe(429);
    expect(rowCount()).toBe(1);

    clock = START + 60;
    expect((await request(strict).get(`/notes/${code}`)).body.content).toBe('still here');
  });

  it('leaves the home page and static files alone', async () => {
    const strict = limited({ requests: { limit: 1, windowSeconds: 60 } });
    for (let i = 0; i < 5; i++) {
      expect((await request(strict).get('/')).status).toBe(200);
      expect((await request(strict).get('/styles.css')).status).toBe(200);
    }
  });
});
