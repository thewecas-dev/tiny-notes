import type { Db } from './db.js';

// Reads and writes for the analytics page. Per-note numbers are kept by triggers (src/db.ts);
// this file adds the two things triggers cannot see, and builds the report.

export interface Summary {
  min: number | null;
  median: number | null;
  avg: number | null;
  max: number | null;
}

export interface Bucket {
  label: string;
  count: number;
}

export interface Report {
  totals: {
    notes: number;
    last24h: number;
    last7d: number;
    last30d: number;
    active: number;
    reveals: number;
    notesRevealed: number;
    ended: number;
    endedViewed: number;
    expiredUnread: number;
    expiredPartly: number;
    linkOpens: number;
    deadLinkOpens: number;
    rateLimited: number;
  };
  textBytes: Summary;
  viewsAllowed: Summary;
  viewsUsed: Summary;
  expiresIn: Summary;
  /** Seconds from creating a note to its first reveal. */
  firstView: Summary;
  /** Seconds from creating a note to it being gone. */
  lifetime: Summary;
  /** Share of the allowed lifetime that had passed at the first reveal, 0 to 1. */
  waitShare: number | null;
  buckets: { textBytes: Bucket[]; expiresIn: Bucket[]; viewsAllowed: Bucket[]; firstView: Bucket[] };
  /** Notes created per UTC day, oldest first, last 30 days. */
  daily: { day: string; count: number }[];
  /** Notes created per UTC hour of day, index 0 to 23. */
  hourly: number[];
}

export type Analytics = ReturnType<typeof createAnalytics>;

const FIRST_VIEW = 'first_viewed_at - created_at';
const LIFETIME = 'ended_at - created_at';

// Each list pairs with the CASE in bucketSql(): labels in order, then the upper bound of each.
const BUCKETS = {
  textBytes: { expr: 'text_bytes', labels: ['Under 100 B', '100 B to 1 KB', '1 to 10 KB', 'Over 10 KB'], below: [100, 1000, 10_000] },
  viewsAllowed: { expr: 'max_views', labels: ['1 view', '2 to 5', '6 to 20', '21 to 100'], below: [2, 6, 21] },
  firstView: {
    expr: FIRST_VIEW,
    labels: ['Under 1 min', '1 to 10 min', '10 to 60 min', '1 to 6 h', '6 to 24 h', 'Over a day'],
    below: [60, 600, 3600, 21_600, 86_400],
  },
} as const;

const EXPIRY_LABELS: Record<string, string> = { 300: '5 min', 3600: '1 hour', 86400: '1 day', 604800: '7 days' };

function bucketSql({ expr, below }: { expr: string; below: readonly number[] }): string {
  const cases = below.map((limit, i) => `WHEN ${expr} < ${limit} THEN ${i}`).join(' ');
  return `SELECT CASE ${cases} ELSE ${below.length} END AS b, COUNT(*) AS c
          FROM note_stats WHERE ${expr} IS NOT NULL GROUP BY b`;
}

const medianSql = (expr: string) =>
  `SELECT ${expr} AS v FROM note_stats WHERE ${expr} IS NOT NULL ORDER BY v
   LIMIT 1 OFFSET (SELECT COUNT(*) / 2 FROM note_stats WHERE ${expr} IS NOT NULL)`;

const summarySql = (expr: string, name: string) =>
  `MIN(${expr}) AS ${name}_min, AVG(${expr}) AS ${name}_avg, MAX(${expr}) AS ${name}_max`;

export function createAnalytics(db: Db) {
  return {
    /** A live note's page was opened (not the same as revealed). */
    async linkOpened(code: string): Promise<void> {
      await db.execute({ sql: 'UPDATE note_stats SET link_opens = link_opens + 1 WHERE code = ?', args: [code] });
    },

    /** Adds one to today's count of something not tied to a live note. */
    async count(name: 'dead_link_opens' | 'rate_limited'): Promise<void> {
      await db.execute({
        sql: `INSERT INTO counters (day, name, value) VALUES (date('now'), ?, 1)
              ON CONFLICT (day, name) DO UPDATE SET value = value + 1`,
        args: [name],
      });
    },

    /** Everything the analytics page shows, in one round trip. */
    async report(now: number): Promise<Report> {
      const since30 = now - 30 * 86_400;
      const [totals, medText, medViews, medUsed, medExpiry, medFirst, medLife, bText, bViews, bFirst, bExpiry, daily, hourly, counters] =
        await db.batch(
          [
            {
              sql: `SELECT COUNT(*) AS notes,
                      SUM(created_at > :now - 86400) AS last24h,
                      SUM(created_at > :now - 604800) AS last7d,
                      SUM(created_at > :now - 2592000) AS last30d,
                      SUM(ended_at IS NULL AND created_at + expires_in > :now) AS active,
                      SUM(views_used) AS reveals,
                      SUM(views_used > 0) AS notes_revealed,
                      SUM(ended_at IS NOT NULL) AS ended,
                      SUM(end_reason = 'viewed') AS ended_viewed,
                      SUM(end_reason = 'expired' AND views_used = 0) AS expired_unread,
                      SUM(end_reason = 'expired' AND views_used > 0) AS expired_partly,
                      SUM(link_opens) AS link_opens,
                      ${summarySql('text_bytes', 'text')}, ${summarySql('max_views', 'allowed')},
                      ${summarySql('views_used', 'used')}, ${summarySql('expires_in', 'expiry')},
                      ${summarySql(FIRST_VIEW, 'first')}, ${summarySql(LIFETIME, 'life')},
                      AVG(1.0 * (${FIRST_VIEW}) / expires_in) AS wait_share
                    FROM note_stats`,
              args: { now },
            },
            medianSql('text_bytes'),
            medianSql('max_views'),
            medianSql('views_used'),
            medianSql('expires_in'),
            medianSql(FIRST_VIEW),
            medianSql(LIFETIME),
            bucketSql(BUCKETS.textBytes),
            bucketSql(BUCKETS.viewsAllowed),
            bucketSql(BUCKETS.firstView),
            'SELECT expires_in AS b, COUNT(*) AS c FROM note_stats GROUP BY b',
            {
              sql: `SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS c
                    FROM note_stats WHERE created_at >= ? GROUP BY day`,
              args: [since30],
            },
            `SELECT CAST(strftime('%H', created_at, 'unixepoch') AS INTEGER) AS h, COUNT(*) AS c
             FROM note_stats GROUP BY h`,
            'SELECT name, SUM(value) AS v FROM counters GROUP BY name',
          ],
          'read',
        );

      const t = totals!.rows[0]!;
      const num = (value: unknown) => Number(value ?? 0);
      const orNull = (value: unknown) => (value == null ? null : Number(value));
      const median = (result: typeof medText) => orNull(result!.rows[0]?.v);
      const summary = (name: string, med: typeof medText): Summary => ({
        min: orNull(t[`${name}_min`]),
        median: median(med),
        avg: orNull(t[`${name}_avg`]),
        max: orNull(t[`${name}_max`]),
      });
      const fill = (labels: readonly string[], result: typeof bText): Bucket[] =>
        labels.map((label, i) => ({
          label,
          count: num(result!.rows.find((row) => Number(row.b) === i)?.c),
        }));

      // Expiry choices: the four presets, plus everything else as "Custom".
      const expiry: Bucket[] = Object.entries(EXPIRY_LABELS).map(([seconds, label]) => ({
        label,
        count: num(bExpiry!.rows.find((row) => Number(row.b) === Number(seconds))?.c),
      }));
      expiry.push({
        label: 'Custom',
        count: bExpiry!.rows.filter((row) => !(String(row.b) in EXPIRY_LABELS)).reduce((sum, row) => sum + num(row.c), 0),
      });

      const days = Array.from({ length: 30 }, (_, i) => new Date((now - (29 - i) * 86_400) * 1000).toISOString().slice(0, 10));
      const counter = (name: string) => num(counters!.rows.find((row) => row.name === name)?.v);

      return {
        totals: {
          notes: num(t.notes),
          last24h: num(t.last24h),
          last7d: num(t.last7d),
          last30d: num(t.last30d),
          active: num(t.active),
          reveals: num(t.reveals),
          notesRevealed: num(t.notes_revealed),
          ended: num(t.ended),
          endedViewed: num(t.ended_viewed),
          expiredUnread: num(t.expired_unread),
          expiredPartly: num(t.expired_partly),
          linkOpens: num(t.link_opens),
          deadLinkOpens: counter('dead_link_opens'),
          rateLimited: counter('rate_limited'),
        },
        textBytes: summary('text', medText),
        viewsAllowed: summary('allowed', medViews),
        viewsUsed: summary('used', medUsed),
        expiresIn: summary('expiry', medExpiry),
        firstView: summary('first', medFirst),
        lifetime: summary('life', medLife),
        waitShare: orNull(t.wait_share),
        buckets: {
          textBytes: fill(BUCKETS.textBytes.labels, bText),
          expiresIn: expiry,
          viewsAllowed: fill(BUCKETS.viewsAllowed.labels, bViews),
          firstView: fill(BUCKETS.firstView.labels, bFirst),
        },
        daily: days.map((day) => ({ day, count: num(daily!.rows.find((row) => row.day === day)?.c) })),
        hourly: Array.from({ length: 24 }, (_, h) => num(hourly!.rows.find((row) => Number(row.h) === h)?.c)),
      };
    },
  };
}
