import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { copyText, formatDateTime, formatRemaining, formatViews } from '../format';
import { NoteLink, extractCode } from '../note-link';
import { NoteContent, NoteMeta, NotesApi, errorCode, errorMessage } from '../notes.api';

type State =
  | { kind: 'lookup' }
  | { kind: 'loading' }
  | { kind: 'ready'; meta: NoteMeta }
  | { kind: 'revealed'; note: NoteContent }
  | { kind: 'gone' }
  | { kind: 'error'; message: string };

@Component({
  selector: 'app-open-note',
  imports: [FormsModule],
  templateUrl: './open-note.html',
})
export class OpenNote {
  private readonly api = inject(NotesApi);
  private readonly link = inject(NoteLink);

  protected readonly state = signal<State>({ kind: 'lookup' });
  protected readonly lookup = signal('');
  protected readonly lookupError = signal(false);
  protected readonly revealing = signal(false);
  protected readonly copied = signal(false);

  protected readonly readySummary = computed(() => {
    const state = this.state();
    if (state.kind !== 'ready') return null;
    return {
      views: `${formatViews(state.meta.views_left)} left`,
      remaining: formatRemaining(state.meta.expires_at),
      expiresAt: formatDateTime(state.meta.expires_at),
    };
  });

  protected readonly revealedSummary = computed(() => {
    const state = this.state();
    if (state.kind !== 'revealed') return '';
    return state.note.views_left === 0
      ? 'That was the last view. The note has been deleted from the server, so copy it now if you need it.'
      : `${formatViews(state.note.views_left)} left on this note.`;
  });

  constructor() {
    effect(() => {
      const code = this.link.code();
      if (code) void this.loadMeta(code);
      else this.state.set({ kind: 'lookup' });
    });
  }

  private async loadMeta(code: string): Promise<void> {
    this.state.set({ kind: 'loading' });
    this.copied.set(false);
    let next: State;
    try {
      next = { kind: 'ready', meta: await this.api.meta(code) };
    } catch (err) {
      next = this.failure(err);
    }
    // Ignore the answer if the user moved to another note meanwhile.
    if (this.link.code() === code) this.state.set(next);
  }

  protected async reveal(): Promise<void> {
    const code = this.link.code();
    if (!code || this.revealing()) return;
    this.revealing.set(true);
    try {
      this.state.set({ kind: 'revealed', note: await this.api.read(code) });
    } catch (err) {
      this.state.set(this.failure(err));
    } finally {
      this.revealing.set(false);
    }
  }

  private failure(err: unknown): State {
    return errorCode(err) === 'not_found'
      ? { kind: 'gone' }
      : { kind: 'error', message: errorMessage(err) };
  }

  protected retry(): void {
    const code = this.link.code();
    if (code) void this.loadMeta(code);
  }

  protected submitLookup(): void {
    const code = extractCode(this.lookup());
    this.lookupError.set(!code);
    if (code) {
      this.lookup.set('');
      this.link.open(code);
    }
  }

  protected async copy(content: string): Promise<void> {
    this.copied.set(await copyText(content));
  }

  protected close(): void {
    this.link.clear();
  }
}
