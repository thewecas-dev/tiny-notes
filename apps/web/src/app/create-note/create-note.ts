import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { copyText, formatBytes, formatDateTime, formatViews } from '../format';
import { NoteLink } from '../note-link';
import { CreatedNote, NotesApi, errorMessage } from '../notes.api';

const MAX_BODY_BYTES = 100 * 1024;
const MIN_EXPIRY = 60;
const MAX_EXPIRY = 604_800;
const encoder = new TextEncoder();

@Component({
  selector: 'app-create-note',
  imports: [FormsModule],
  templateUrl: './create-note.html',
})
export class CreateNote {
  private readonly api = inject(NotesApi);
  private readonly link = inject(NoteLink);

  protected readonly presets = [
    { label: '5 min', seconds: 300 },
    { label: '1 hour', seconds: 3600 },
    { label: '1 day', seconds: 86_400 },
    { label: '7 days', seconds: MAX_EXPIRY },
  ];
  protected readonly units = [
    { label: 'minutes', seconds: 60 },
    { label: 'hours', seconds: 3600 },
    { label: 'days', seconds: 86_400 },
  ];

  protected readonly content = signal('');
  protected readonly maxViews = signal<number | null>(1);
  protected readonly expiry = signal<number | 'custom'>(86_400);
  protected readonly customValue = signal<number | null>(30);
  protected readonly customUnit = signal(60);

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly created = signal<CreatedNote | null>(null);
  protected readonly copied = signal(false);

  protected readonly expiresIn = computed(() => {
    const expiry = this.expiry();
    return expiry === 'custom' ? (this.customValue() ?? NaN) * this.customUnit() : expiry;
  });

  protected readonly contentBytes = computed(() => encoder.encode(this.content()).length);
  protected readonly sizeLabel = computed(() => formatBytes(this.contentBytes()));

  // The server caps the whole JSON body, so measure what will actually be sent.
  protected readonly tooLarge = computed(
    () => encoder.encode(JSON.stringify(this.payload())).length > MAX_BODY_BYTES,
  );
  protected readonly viewsInvalid = computed(() => {
    const views = this.maxViews();
    return views === null || !Number.isInteger(views) || views < 1 || views > 100;
  });
  protected readonly expiryInvalid = computed(() => {
    const seconds = this.expiresIn();
    return !Number.isInteger(seconds) || seconds < MIN_EXPIRY || seconds > MAX_EXPIRY;
  });
  protected readonly canSubmit = computed(
    () =>
      this.content().trim() !== '' &&
      !this.tooLarge() &&
      !this.viewsInvalid() &&
      !this.expiryInvalid() &&
      !this.submitting(),
  );

  protected readonly shareUrl = computed(() => {
    const created = this.created();
    return created ? this.link.urlFor(created.code) : '';
  });
  protected readonly createdSummary = computed(() => {
    const created = this.created();
    if (!created) return '';
    return `Good for ${formatViews(created.views_left)}, until ${formatDateTime(created.expires_at)}.`;
  });

  private payload() {
    return {
      content: this.content(),
      max_views: this.maxViews() ?? 1,
      expires_in: this.expiresIn(),
    };
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.submitting.set(true);
    this.error.set(null);
    try {
      this.created.set(await this.api.create(this.payload()));
      this.content.set('');
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.submitting.set(false);
    }
  }

  protected async copy(): Promise<void> {
    this.copied.set(await copyText(this.shareUrl()));
  }

  protected reset(): void {
    this.created.set(null);
    this.copied.set(false);
  }
}
