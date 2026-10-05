import { decrypt, encrypt, newKey } from './crypto.js';

const $ = (selector) => document.querySelector(selector);
const KEY = /^[\w-]{43}$/;
// Largest note that still fits the server's 100 KB request cap once encrypted and encoded.
const MAX_BYTES = 75_000;

// "2 minutes" or "40 seconds", from the server's Retry-After header.
const retryAfter = (response) => {
  const seconds = Number(response.headers.get('Retry-After')) || 60;
  return seconds >= 90 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
};

const show = (el, message) => {
  el.textContent = message;
  el.hidden = false;
};

// Copy buttons. Delegated so buttons added later (the revealed note) work too.
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const target = $(button.dataset.copy);
  await navigator.clipboard.writeText(target.value ?? target.textContent);
  const label = button.textContent;
  button.textContent = 'Copied';
  setTimeout(() => (button.textContent = label), 1600);
});

// ---- Write a note ----
const form = $('#create');
if (form) {
  const content = $('#content');
  const views = $('#max-views');
  const error = $('#create-error');
  const serverView = $('#server-view');
  const submit = form.querySelector('[type=submit]');
  const emptyText = serverView.textContent;

  if (!globalThis.crypto?.subtle) {
    show(error, 'This page needs a secure (HTTPS) connection to encrypt your note.');
    submit.disabled = true;
  } else {
    const key = newKey();
    const bytesOf = () => new TextEncoder().encode(content.value).length;
    const expiresIn = () => {
      const data = new FormData(form);
      return data.get('expires') === 'custom'
        ? Number(data.get('custom_value')) * Number(data.get('custom_unit'))
        : Number(data.get('expires'));
    };
    const deadline = new Intl.DateTimeFormat(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    });

    let latest = 0;
    const refresh = async () => {
      const bytes = bytesOf();
      $('#size').textContent = `${bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} KB`} / 75 KB`;
      $('#size').classList.toggle('counter-over', bytes > MAX_BYTES);
      $('#size-bar').value = bytes;
      $('#views-unit').textContent = views.value === '1' ? 'time' : 'times';

      const seconds = expiresIn();
      const expiryOk = Number.isInteger(seconds) && seconds >= 60 && seconds <= 604_800;
      $('#expiry-readout').textContent = expiryOk
        ? `Deletes itself by ${deadline.format(Date.now() + seconds * 1000)}, or sooner once it has been read.`
        : 'Choose between 1 minute and 7 days.';

      // Show exactly what would be sent: the note, encrypted with this page's key.
      const run = ++latest;
      const cipher = content.value ? await encrypt(content.value, key) : '';
      if (run !== latest) return expiryOk;
      serverView.textContent = cipher ? (cipher.length > 420 ? `${cipher.slice(0, 420)}…` : cipher) : emptyText;
      serverView.classList.toggle('wire-live', Boolean(cipher));
      return expiryOk;
    };

    form.addEventListener('input', refresh);
    form.addEventListener('click', (event) => {
      const step = event.target.closest('[data-step]');
      if (!step) return;
      views.value = Math.min(100, Math.max(1, (Number(views.value) || 1) + Number(step.dataset.step)));
      refresh();
    });
    refresh();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.hidden = true;
      const maxViews = Number(views.value);
      if (!content.value.trim()) return show(error, 'Write something first.');
      if (bytesOf() > MAX_BYTES) return show(error, 'That note is too large. The limit is 75 KB.');
      if (!Number.isInteger(maxViews) || maxViews < 1 || maxViews > 100) {
        return show(error, 'Views must be a whole number from 1 to 100.');
      }
      if (!(await refresh())) return show(error, 'Choose an expiry between 1 minute and 7 days.');

      submit.disabled = true;
      try {
        const response = await fetch('/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: await encrypt(content.value, key),
            max_views: maxViews,
            expires_in: expiresIn(),
          }),
        });
        if (response.status === 429) {
          submit.disabled = false;
          return show(error, `Too many notes created from this network. Try again in ${retryAfter(response)}.`);
        }
        if (!response.ok) throw new Error(String(response.status));
        const { code } = await response.json();
        // The key goes after the #, so it is never part of any request.
        location.assign(`/n/${code}?created=1#${key}`);
      } catch {
        show(error, 'The note could not be saved. Check your connection and try again.');
        submit.disabled = false;
      }
    });
  }
}

// ---- Link ready ----
const linkKey = $('#link-key');
if (linkKey) {
  if (KEY.test(location.hash.slice(1))) {
    linkKey.textContent = location.hash;
    const share = $('#share');
    if (navigator.share) {
      share.hidden = false;
      share.addEventListener('click', () => navigator.share({ url: $('#share-link').textContent }).catch(() => {}));
    }
  } else {
    $('#link-actions').hidden = true;
    $('#key-missing').hidden = false;
  }
}

// ---- Open a note ----
const waiting = $('#waiting');
if (waiting) {
  const key = location.hash.slice(1);
  const reveal = $('#reveal');
  const error = $('#reveal-error');
  const clock = $('[data-expires]');

  if (!KEY.test(key)) {
    show(error, 'This link is missing its key, the part after the # sign. Ask the sender for the complete link.');
    reveal.disabled = true;
  }
  // Editing only the part after # does not reload the page, so pick up a pasted key here.
  // Not once the note is showing: a reload then would throw the revealed text away.
  addEventListener('hashchange', () => {
    if (reveal.isConnected) location.reload();
  });

  const timer = setInterval(() => {
    if (!clock.isConnected) return clearInterval(timer);
    const left = clock.dataset.expires - Math.floor(Date.now() / 1000);
    if (left <= 0) return location.reload();
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    clock.textContent =
      h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h ${m} min` : `${h} h ${m} min ${left % 60} s`;
  }, 1000);

  const swap = (template) => waiting.replaceChildren($(template).content.cloneNode(true));

  reveal.addEventListener('click', async () => {
    reveal.disabled = true;
    error.hidden = true;
    try {
      const response = await fetch(`/notes/${waiting.dataset.code}`);
      if (response.status === 404) return swap('#gone-template');
      if (response.status === 429) {
        reveal.disabled = false;
        return show(error, `Too many requests from this network. No view was used. Try again in ${retryAfter(response)}.`);
      }
      if (!response.ok) throw new Error(String(response.status));
      const { content, views_left: viewsLeft } = await response.json();

      let text;
      try {
        text = await decrypt(content, key);
      } catch {
        return show(error, 'This link has the wrong key, so the note cannot be unlocked. One view was used.');
      }
      swap('#revealed-template');
      $('#note').textContent = text;
      $('#revealed-summary').textContent =
        viewsLeft === 0
          ? 'That was the last view. The note has been deleted from the server, so copy it now if you need it.'
          : `${viewsLeft} ${viewsLeft === 1 ? 'view' : 'views'} left on this note.`;
    } catch {
      show(error, 'The note could not be loaded. Check your connection and try again.');
      reveal.disabled = false;
    }
  });
}

// ---- Expand the card to fill the window, for reading or writing a long note ----
const expand = $('#expand');
if (expand) {
  expand.hidden = false;
  // The class is on <html> and remembered for the tab, so switching between Write and Open
  // (a page load) keeps the view expanded. /expanded.js re-applies it before first paint.
  const root = document.documentElement;
  const setExpanded = (on) => {
    root.classList.toggle('expanded', on);
    try {
      if (on) sessionStorage.setItem('expanded', '1');
      else sessionStorage.removeItem('expanded');
    } catch {
      // Storage blocked: expanding still works, it just will not survive a page change.
    }
    expand.setAttribute('aria-pressed', String(on));
    expand.title = on ? 'Collapse' : 'Expand';
    expand.setAttribute('aria-label', expand.title);
  };
  setExpanded(root.classList.contains('expanded'));
  expand.addEventListener('click', () => setExpanded(!root.classList.contains('expanded')));
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setExpanded(false);
  });
}

// ---- Find a note from a pasted link. Handled here so the key is never sent anywhere. ----
$('#lookup')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const match = /\/n\/([\w-]{8})(?:\?[^#]*)?#([\w-]{43})\s*$/.exec($('#lookup-input').value);
  if (match) location.assign(`/n/${match[1]}#${match[2]}`);
  else show($('#lookup-error'), 'Paste the complete link, including the part after the # sign.');
});
