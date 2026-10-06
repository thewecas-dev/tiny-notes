import type { Bucket, Report, Summary } from './analytics.js';

// The analytics page. Design source: Figma "Tiny Notes — Brand", frame "Analytics / Desktop / Dark".
// Charts are server-rendered: <progress> for bar lists and inline SVG for column charts, so the
// page needs no script and stays inside the site's Content-Security-Policy.

const int = new Intl.NumberFormat('en');
const count = (n: number) => int.format(Math.round(n));
const dash = '–';

const percent = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : dash);

function bytes(n: number | null): string {
  if (n == null) return dash;
  return n < 1000 ? `${Math.round(n)} B` : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} KB`;
}

/** One decimal, dropped when it is zero: 1.5, 1, 7. */
const trim = (n: number) => String(Number(n.toFixed(1)));

function duration(seconds: number | null): string {
  if (seconds == null) return dash;
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${trim(s / 3600)} h`;
  const days = trim(s / 86_400);
  return `${days} ${days === '1' ? 'day' : 'days'}`;
}

const plain = (n: number | null) => (n == null ? dash : Number.isInteger(n) ? count(n) : n.toFixed(1));

const tile = (label: string, value: string, note: string) => `<li class="tile">
        <p class="tile-label">${label}</p>
        <p class="tile-value">${value}</p>
        <p class="tile-note">${note}</p>
      </li>`;

/** Label, a thin bar, the number. One hue throughout: the bars show how many, not which. */
function barList(rows: Bucket[]): string {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return `<ul class="bars">
          ${rows
            .map(
              (row) =>
                `<li><span>${row.label}</span><progress max="${max}" value="${row.count}"></progress><b>${count(row.count)}</b></li>`,
            )
            .join('\n          ')}
        </ul>`;
}

const summary = (items: [label: string, value: string][]) => `<dl class="summary">
          ${items.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}
        </dl>`;

const spread = (s: Summary, format: (n: number | null) => string) =>
  summary([
    ['Smallest', format(s.min)],
    ['Median', format(s.median)],
    ['Average', format(s.avg)],
    ['Largest', format(s.max)],
  ]);

/** A column chart as inline SVG, with a hover title on each column and a table underneath. */
function columns(points: { label: string; value: number }[], axis: string[], unit: string, width = 600): string {
  const height = 170;
  const gap = 2;
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = width / points.length;
  const w = step - gap;
  const r = Math.min(4, w / 2);
  const bars = points
    .map((p, i) => {
      if (!p.value) return '';
      const h = Math.max(r + 1, ((height - 6) * p.value) / max);
      const x = i * step + gap / 2;
      const y = height - h;
      // Rounded at the data end only, square on the baseline.
      const d = `M${x.toFixed(1)} ${height}V${(y + r).toFixed(1)}a${r} ${r} 0 0 1 ${r}-${r}h${(w - 2 * r).toFixed(1)}a${r} ${r} 0 0 1 ${r} ${r}V${height}z`;
      return `<path class="col" d="${d}"><title>${p.label}: ${count(p.value)} ${unit}</title></path>`;
    })
    .join('');
  return `<figure class="chart">
          <svg viewBox="0 0 ${width} ${height + 1}" role="img" aria-label="Column chart, ${points.length} columns. The same numbers are in the table below.">
            ${bars}<line class="baseline" x1="0" x2="${width}" y1="${height + 0.5}" y2="${height + 0.5}"/>
          </svg>
          <figcaption class="axis">${axis.map((label) => `<span>${label}</span>`).join('')}</figcaption>
          <details>
            <summary>Show as a table</summary>
            <table><tbody>${points.map((p) => `<tr><th scope="row">${p.label}</th><td>${count(p.value)}</td></tr>`).join('')}</tbody></table>
          </details>
        </figure>`;
}

const card = (title: string, note: string, body: string, wide = false) => `<section class="panel${wide ? ' panel-wide' : ''}">
        <h2>${title}</h2>
        <p class="panel-note">${note}</p>
        ${body}
      </section>`;

const shortDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function analyticsPage(report: Report, now: number): string {
  const t = report.totals;
  const read = t.endedViewed + t.expiredPartly;
  const busiest = report.daily.reduce((best, day) => (day.count > best.count ? day : best), report.daily[0]!);
  const updated = new Date(now * 1000).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });

  const body = t.notes
    ? `<ul class="tiles">
      ${tile('Notes created', count(t.notes), `${count(t.last24h)} in the last day, ${count(t.last7d)} in the last week, ${count(t.last30d)} in 30 days`)}
      ${tile('Waiting to be read', count(t.active), 'Notes that still have views and time left')}
      ${tile('Read at least once', percent(read, t.ended), `${count(read)} of ${count(t.ended)} finished notes were revealed`)}
      ${tile('Expired unread', percent(t.expiredUnread, t.ended), `${count(t.expiredUnread)} notes ran out of time before anyone opened them`)}
    </ul>

    <div class="grid">
      ${card(
        'Notes per day',
        `Last 30 days. Busiest day: ${count(busiest.count)} on ${shortDay(busiest.day)}.`,
        columns(
          report.daily.map((d) => ({ label: shortDay(d.day), value: d.count })),
          [0, 7, 14, 21, 29].map((i) => shortDay(report.daily[i]!.day)),
          'notes',
        ),
        true,
      )}
      ${card(
        'Busiest hours',
        'When notes are created, by hour of day.',
        columns(
          report.hourly.map((value, hour) => ({ label: `${String(hour).padStart(2, '0')}:00`, value })),
          ['00', '06', '12', '18', '23'],
          'notes',
          340,
        ),
      )}
      ${card(
        'How notes end',
        'A high unread share suggests expiry times are too short, or links are not reaching people.',
        barList([
          { label: 'All views used', count: t.endedViewed },
          { label: 'Expired, partly read', count: t.expiredPartly },
          { label: 'Expired unread', count: t.expiredUnread },
        ]) +
          summary([
            ['Reveals in total', count(t.reveals)],
            ['Views used per note', `${plain(report.viewsUsed.avg)} of ${plain(report.viewsAllowed.avg)}`],
            ['Dead links opened', count(t.deadLinkOpens)],
          ]),
      )}
      ${card(
        'Time to first reveal',
        report.waitShare == null
          ? 'How long a note waits before its recipient opens it.'
          : `How long a note waits before its recipient opens it. On average that is ${Math.round(report.waitShare * 100)}% of the way through its lifetime.`,
        barList(report.buckets.firstView) +
          summary([
            ['Shortest', duration(report.firstView.min)],
            ['Median', duration(report.firstView.median)],
            ['Average', duration(report.firstView.avg)],
            ['Longest', duration(report.firstView.max)],
          ]),
      )}
      ${card(
        'Note size',
        'Mostly short secrets, or longer text? Estimated from the encrypted size.',
        barList(report.buckets.textBytes) + spread(report.textBytes, bytes),
      )}
      ${card(
        'Expiry chosen',
        'Which lifetime people pick. The default is 1 day.',
        barList(report.buckets.expiresIn) + spread(report.expiresIn, duration),
      )}
      ${card(
        'View limit chosen',
        'How many opens people allow. The default is 1.',
        barList(report.buckets.viewsAllowed) + spread(report.viewsAllowed, plain),
      )}
      ${card(
        'How long notes live',
        'From creation until the note is gone, whether read or expired.',
        spread(report.lifetime, duration),
      )}
      ${card(
        'Links and limits',
        'Link opens count visits to a live note page, including chat-app previews. Dead links are visits to notes already gone.',
        summary([
          ['Link opens', count(t.linkOpens)],
          ['Dead links opened', count(t.deadLinkOpens)],
          ['Requests refused by rate limits', count(t.rateLimited)],
        ]),
      )}
    </div>`
    : `<p class="empty">No notes have been created yet. Numbers appear here after the first one.</p>`;

  return shell(
    `<span class="updated">Updated ${updated} UTC. All times are UTC.</span>`,
    `<main class="wrap analytics">
  <h1>How notes are being used</h1>
  <p class="lede">Counts and timings only. No note content, links, keys or visitor details are stored here.</p>
  ${body}
</main>`,
  );
}

/** The password form. Shown on its own: no numbers are on the page until the password is checked. */
export function analyticsLogin(error?: string): string {
  return shell(
    '',
    `<main class="wrap analytics-login">
  <form class="card" method="post" action="/analytics">
    <h1>Analytics</h1>
    <p class="muted">Enter the password to load the numbers.</p>
    <div class="field">
      <label for="password">Password</label>
      <input id="password" name="password" class="input" type="password" autocomplete="current-password" required autofocus>
      ${error ? `<p class="field-error" role="alert">${error}</p>` : ''}
    </div>
    <button type="submit" class="btn btn-primary btn-block">Show analytics</button>
  </form>
</main>`,
  );
}

function shell(headerRight: string, main: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Analytics · Tiny Notes</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="color-scheme" content="light dark">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/analytics.css">
</head>
<body>
<header class="topbar">
  <div class="wrap topbar-inner">
    <span class="brand"><img src="/favicon.svg" width="30" height="30" alt="">tiny notes <span class="brand-sub">Analytics</span></span>
    ${headerRight}
  </div>
</header>
${main}
</body>
</html>
`;
}
