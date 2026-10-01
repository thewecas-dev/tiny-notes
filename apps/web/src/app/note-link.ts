import { Injectable, signal } from '@angular/core';

const CODE = /^[A-Za-z0-9_-]{8}$/;

/** Pulls a note code out of a bare code or a pasted share link. */
export function extractCode(text: string): string | null {
  const candidate = text.trim().split('#').pop() ?? '';
  return CODE.test(candidate) ? candidate : null;
}

/** The note code lives in the URL fragment, e.g. https://host/#aB3xK9pQ. */
@Injectable({ providedIn: 'root' })
export class NoteLink {
  readonly code = signal(extractCode(location.hash));

  constructor() {
    window.addEventListener('hashchange', () => this.code.set(extractCode(location.hash)));
  }

  urlFor(code: string): string {
    return `${location.origin}${location.pathname}#${code}`;
  }

  open(code: string): void {
    history.replaceState(null, '', `#${code}`);
    this.code.set(code);
  }

  clear(): void {
    history.replaceState(null, '', location.pathname + location.search);
    this.code.set(null);
  }
}
