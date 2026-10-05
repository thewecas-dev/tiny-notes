// End-to-end encryption for notes: AES-256-GCM from the browser's built-in Web Crypto.
// The key is made here and only ever travels in the link's #fragment, which browsers
// do not send to servers. The server stores encrypt()'s output and nothing else.

const toBase64Url = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const importKey = (key) =>
  crypto.subtle.importKey('raw', fromBase64Url(key), 'AES-GCM', false, ['encrypt', 'decrypt']);

/** A fresh random 256-bit key, as 43 URL-safe characters. */
export const newKey = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

/** Returns base64url(iv + ciphertext + auth tag). A new random IV is used every time. */
export async function encrypt(text, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(key), new TextEncoder().encode(text)),
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return toBase64Url(out);
}

/** Throws if the key is wrong or the payload was altered. */
export async function decrypt(payload, key) {
  const data = fromBase64Url(payload);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.subarray(0, 12) },
    await importKey(key),
    data.subarray(12),
  );
  return new TextDecoder().decode(plain);
}
