import type { Request, Response } from 'express';

// HTML pages, rendered on the server as template strings. Every dynamic value goes through esc().
// Notes are encrypted and decrypted in the browser (public/crypto.js); nothing here sees plaintext.

const SITE = 'Tiny Notes';
const HOME_TITLE = 'Tiny Notes: end-to-end encrypted, self-destructing notes';
const DESCRIPTION =
  'Share a password, API key or private message with an end-to-end encrypted, one-time link. The note deletes itself after it is read. Free, no account.';

const esc = (value: unknown) =>
  String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "2 days 3 h", "5 h 12 min", "42 min", "less than a minute". */
export function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'less than a minute';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${plural(days, 'day')}${hours ? ` ${hours} h` : ''}`;
  if (hours > 0) return `${hours} h${mins ? ` ${mins} min` : ''}`;
  return `${mins} min`;
}

// The route the locked note takes. The key takes a different one: see the key lane in page().
const STOPS = [
  ['Your browser', 'Locks the note', 'Makes a random 256-bit key and encrypts your note with AES-256-GCM before anything is sent.'],
  ['Our server', 'Stores what it cannot read', 'Keeps the locked text, a view count and an expiry time. Deletes it after the last view or when time runs out, whichever comes first.'],
  ['Their browser', 'Unlocks the note', 'Fetches the locked text and opens it with the key from the link, on their device.'],
] as const;

// Who can read a note, and why. `reads` drives the verdict shown for each.
const WHO = [
  {
    id: 'recipient',
    label: 'Your recipient',
    reads: true,
    has: ['The complete link', 'The key, in the part after the #'],
    why: 'Their browser fetches the locked note and unlocks it with the key from the link, on their device. Anyone holding the complete link counts as a recipient, so send it through a channel you trust.',
  },
  {
    id: 'server',
    label: 'Our server',
    reads: false,
    has: ['The locked text', 'A view count and an expiry time'],
    why: 'The key is never part of any request. It lives after the # in the link, and browsers do not send that part. The server cannot decrypt what it stores, and cannot log a key it never receives.',
  },
  {
    id: 'database',
    label: 'Someone with the database',
    reads: false,
    has: ['A copy of the locked text', 'Nothing else of use'],
    why: 'Keys are not stored anywhere on our side, so a leaked database or backup holds only locked notes. Opening one without its key means breaking AES-256, which is not practical.',
  },
  {
    id: 'network',
    label: 'Someone watching the network',
    reads: false,
    has: ['Locked text passing by', 'Never the key'],
    why: 'The note is already locked before it leaves your browser, and the key is not sent with it. Intercepting the traffic yields the same noise our server holds.',
  },
] as const;

const FACTS = [
  ['Opening a link is free', 'The link shows how many views are left and when the note expires. Only pressing Reveal uses a view.'],
  ['One view means one reader', 'If two people press Reveal on a one-view note at the same moment, exactly one of them gets it.'],
  ['Gone is gone', 'A viewed or expired note cannot be recovered by anyone. A used, expired or mistyped link all look the same.'],
  ['Lose the link, lose the note', 'The key exists only in your link. We cannot look a note up for you or reset anything, because we never had the key.'],
  ['Limits', 'Plain text up to 75 KB, 1 to 100 views, and a lifetime from 1 minute to 7 days.'],
  ['What you are trusting', 'The code on this page does the encrypting. It is small, loads no third-party scripts, and you can read it at /app.js and /crypto.js.'],
] as const;

export interface PageOptions {
  card: string;
  /** The panel beside the card. */
  aside?: string;
  tab?: 'write' | 'open';
  /** Shown in the browser tab and in link previews. Never put note data here. */
  title?: string;
  /** Absolute URL of the page. Set only on pages search engines should index. */
  canonical?: string;
}

const LOGO = '<img src="/favicon.svg" width="30" height="30" alt="">';

export function page({ card, aside = '', tab, title, canonical }: PageOptions, origin: string): string {
  const fullTitle = title ? `${title} · ${SITE}` : HOME_TITLE;
  const seo = canonical
    ? `<link rel="canonical" href="${esc(canonical)}">
  <meta property="og:url" content="${esc(canonical)}">
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE,
    url: canonical,
    description: DESCRIPTION,
    applicationCategory: 'SecurityApplication',
    operatingSystem: 'Any',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  }).replace(/</g, '\\u003c')}</script>`
    : `<meta name="robots" content="noindex, nofollow">`;
  const current = (name: string) => (tab === name ? ' aria-current="page"' : '');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(DESCRIPTION)}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f5f6f3" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0f1312" media="(prefers-color-scheme: dark)">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${SITE}">
  <meta property="og:title" content="${esc(fullTitle)}">
  <meta property="og:description" content="${esc(DESCRIPTION)}">
  <meta property="og:image" content="${esc(origin)}/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Tiny Notes: share it once, then it is gone.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${esc(origin)}/og.png">
  ${seo}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/fonts/bricolage-grotesque.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/styles.css">
  <script type="module" src="/app.js"></script>
</head>
<body>
<header class="topbar">
  <div class="wrap topbar-inner">
    <a class="brand" href="/">${LOGO}tiny notes</a>
    <nav class="topnav" aria-label="Sections">
      <a href="/#how">How it works</a>
      <a href="/#who">Who can read it</a>
    </nav>
  </div>
</header>

<main class="wrap">
  <div class="hero">
    <div class="intro">
      <h1>Share it once.<span class="melt">Then it's gone.</span></h1>
      <p class="lede">
        Your note is encrypted in your browser before it is sent. We store only locked text
        we cannot read, and delete even that once it has been opened or time runs out.
      </p>
      ${aside}
    </div>

    <section class="card" aria-label="Notes">
      <nav class="tabs" aria-label="Choose an action">
        <a href="/"${current('write')}>Write a note</a>
        <a href="/open"${current('open')}>Open a note</a>
      </nav>
      ${card}
      <noscript><p class="alert">Notes are encrypted in your browser, so this page needs JavaScript turned on.</p></noscript>
    </section>
  </div>

  <section class="section" id="how" aria-labelledby="how-title">
    <h2 id="how-title" class="section-title">How it works</h2>
    <p class="section-lede">The note and its key take different routes. Only the two ends ever hold both.</p>
    <div class="diagram">
      <ol class="lane">
        ${STOPS.map(
          ([where, what, text]) => `<li class="stop"><p class="stop-where">${where}</p><h3>${what}</h3><p>${text}</p></li>`,
        ).join('\n        <li class="hop" aria-hidden="true">locked note</li>\n        ')}
      </ol>
      <p class="key-lane">
        <span class="key-mark">The key</span>
        <span>travels inside the link you send, after the #. Browsers never send that part, so it goes from your browser to theirs without touching our server.</span>
        <span class="key-mark key-end" aria-hidden="true">The key</span>
      </p>
    </div>
  </section>

  <section class="section" id="who" aria-labelledby="who-title">
    <h2 id="who-title" class="section-title">Who can read your note?</h2>
    <div class="who">
      <div class="who-tabs">
        ${WHO.map(
          (w, i) =>
            `<label class="${w.reads ? 'reads' : ''}"><input type="radio" name="who" value="${w.id}"${i === 1 ? ' checked' : ''}><span>${w.label}</span></label>`,
        ).join('\n        ')}
      </div>
      ${WHO.map(
        (w) => `<div class="who-panel" data-who="${w.id}">
        <p class="verdict ${w.reads ? 'verdict-yes' : 'verdict-no'}">${w.reads ? 'Can read it' : 'Cannot read it'}</p>
        <div>
          <h3>What they have</h3>
          <ul>${w.has.map((item) => `<li>${item}</li>`).join('')}</ul>
        </div>
        <div>
          <h3>Why</h3>
          <p>${w.why}</p>
        </div>
      </div>`,
      ).join('\n      ')}
    </div>
  </section>

  <section class="section" aria-labelledby="facts-title">
    <h2 id="facts-title" class="section-title">Good to know</h2>
    <ul class="facts">
      ${FACTS.map(([heading, text]) => `<li><h3>${heading}</h3><p>${text}</p></li>`).join('\n      ')}
    </ul>
  </section>
</main>

<footer class="wrap footer">
  <a class="brand" href="/">${LOGO}tiny notes</a>
  <span>No accounts. No tracking. Nothing we can read, and nothing kept after a note is gone.</span>
</footer>
</body>
</html>
`;
}

/** Public origin: the SITE_URL setting, or else the host the request came in on. */
export const siteOrigin = (req: Request): string =>
  req.app.get('siteUrl') ?? `${req.protocol}://${req.get('host')}`;

/** Sends a page. Anything without a canonical URL is private: not indexed, not cached. */
export function sendPage(res: Response, status: number, options: PageOptions): void {
  // No inline or third-party scripts can run, which protects the in-browser encryption.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!options.canonical) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
  }
  res.status(status).type('html').send(page(options, siteOrigin(res.req)));
}

const EXPIRY_PRESETS = [
  ['300', '5 min'],
  ['3600', '1 hour'],
  ['86400', '1 day'],
  ['604800', '7 days'],
  ['custom', 'Custom'],
] as const;

/** The form is submitted by public/app.js, which encrypts the note first. */
export function createFormCard(): string {
  return `<form id="create" novalidate>
        <div class="field">
          <div class="field-head">
            <label for="content">Your note</label>
            <span class="counter" id="size">0 B / 75 KB</span>
          </div>
          <textarea id="content" class="input mono" rows="6" placeholder="Paste a password, API key or one-off message…" autocomplete="off" spellcheck="false"></textarea>
          <progress id="size-bar" max="75000" value="0" aria-hidden="true"></progress>
        </div>

          <div class="field">
            <label for="max-views">Can be opened</label>
            <div class="stepper">
              <button type="button" data-step="-1" aria-label="Fewer views">−</button>
              <input id="max-views" type="number" min="1" max="100" step="1" inputmode="numeric" value="1">
              <button type="button" data-step="1" aria-label="More views">+</button>
              <span id="views-unit">time</span>
            </div>
          </div>

          <fieldset class="field">
            <legend class="label">Expires after</legend>
            <div class="segmented">
              ${EXPIRY_PRESETS.map(
                ([value, label]) =>
                  `<label><input type="radio" name="expires" value="${value}"${value === '86400' ? ' checked' : ''}><span>${label}</span></label>`,
              ).join('\n              ')}
            </div>
            <div class="custom-expiry">
              <input class="input" type="number" name="custom_value" min="1" step="1" aria-label="Expiry amount" value="30">
              <select class="input" name="custom_unit" aria-label="Expiry unit">
                <option value="60">minutes</option><option value="3600">hours</option><option value="86400">days</option>
              </select>
            </div>
          </fieldset>

        <p class="hint" id="expiry-readout" aria-live="polite"></p>
        <p class="alert" id="create-error" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">Create secret link</button>
      </form>`;
}

/** Live view of the ciphertext, filled in by public/app.js as the user types. */
export const serverViewAside = () => `<aside class="wire" aria-labelledby="wire-title">
        <div class="wire-head">
          <h2 id="wire-title">What our server receives</h2>
          <span class="wire-live-tag">Live</span>
        </div>
        <p class="wire-cipher" id="server-view">Start typing. Your note is locked here, in your browser, and this shows exactly what gets sent.</p>
        <p class="wire-key"><span class="key-mark">The key</span> stays in your link, after the #. We never receive it.</p>
      </aside>`;

const noteAside = () => `<aside class="wire" aria-labelledby="wire-title">
        <div class="wire-head">
          <h2 id="wire-title">What our server holds for this note</h2>
        </div>
        <p class="wire-cipher">Locked text it cannot read, a view count and an expiry time. Unlocking happens in the browser of whoever holds the complete link.</p>
        <p class="wire-key"><span class="key-mark">The key</span> is only in the link, after the #. Browsers do not send that part, so it never reaches us.</p>
      </aside>`;

export function lookupCard(): string {
  return `<form id="lookup" novalidate>
        <div class="field">
          <label for="lookup-input">Link to the note</label>
          <input id="lookup-input" class="input mono" type="text" placeholder="Paste the complete link" autocomplete="off" spellcheck="false">
          <p class="field-error" id="lookup-error" role="alert" hidden></p>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Find note</button>
        <p class="hint">The link is read here in your browser. Its key is never sent to us, and finding a note does not use a view.</p>
      </form>`;
}

export function createdCard(url: string, viewsLeft: number, secondsLeft: number): string {
  return `<div class="result" role="status">
        <p class="badge badge-success">Note created</p>
        <h2>Your link is ready</h2>
        <p class="muted">Good for ${plural(viewsLeft, 'view')}, for the next ${formatRemaining(secondsLeft)}. Send it to the person who needs it.</p>
        <p class="link mono" id="share-link"><span>${esc(url)}</span><span class="key-mark" id="link-key"></span></p>
        <div class="actions" id="link-actions">
          <button type="button" class="btn btn-primary" data-copy="#share-link">Copy link</button>
          <button type="button" class="btn btn-quiet" id="share" hidden>Share</button>
        </div>
        <p class="alert" id="key-missing" role="alert" hidden>The key is missing from this page’s address, so the link cannot be rebuilt. Write the note again.</p>
        <p class="hint">The highlighted part is the key. Browsers never send it to us, so only someone with the whole link can read the note.</p>
        <a class="btn btn-ghost" href="/">Write another note</a>
      </div>`;
}

const goneBody = `<p class="badge badge-muted">Gone</p>
        <h2>This note is no longer available</h2>
        <p class="muted">It was already viewed, it expired, or the link is wrong. Ask the sender to create a new one.</p>
        <a class="btn btn-ghost" href="/">Write a note</a>`;

export function waitingCard(code: string, viewsLeft: number, expiresAt: number, secondsLeft: number): string {
  return `<div class="result" id="waiting" data-code="${esc(code)}">
        <p class="badge">Note waiting</p>
        <h2>Someone sent you a note</h2>
        <dl class="stats">
          <div><dt>Views</dt><dd>${plural(viewsLeft, 'view')} left</dd></div>
          <div><dt>Expires in</dt><dd data-expires="${expiresAt}">${formatRemaining(secondsLeft)}</dd></div>
        </dl>
        <p class="hint">Revealing uses one view and cannot be undone. The note is unlocked here, in your browser.</p>
        <p class="alert" id="reveal-error" role="alert" hidden></p>
        <button type="button" class="btn btn-primary btn-block" id="reveal">Reveal note</button>
        <a class="btn btn-ghost" href="/">Not now</a>
      </div>
      <template id="revealed-template">
        <p class="badge badge-success">Revealed</p>
        <pre id="note" class="note-content" tabindex="0"></pre>
        <p class="hint" id="revealed-summary"></p>
        <button type="button" class="btn btn-primary btn-block" data-copy="#note">Copy note</button>
        <a class="btn btn-ghost" href="/">Done</a>
      </template>
      <template id="gone-template">
        ${goneBody}
      </template>`;
}

export function messageCard(badge: string, heading: string, text: string): string {
  return `<div class="result" role="status">
        <p class="badge badge-muted">${esc(badge)}</p>
        <h2>${esc(heading)}</h2>
        <p class="muted">${esc(text)}</p>
        <a class="btn btn-ghost" href="/">Write a note</a>
      </div>`;
}

export const goneCard = () => `<div class="result" role="status">
        ${goneBody}
      </div>`;

export { noteAside };
