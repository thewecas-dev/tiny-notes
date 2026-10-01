import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface CreateNoteRequest {
  content: string;
  max_views: number;
  expires_in: number;
}

export interface CreatedNote {
  code: string;
  views_left: number;
  expires_at: string;
}

export interface NoteContent {
  content: string;
  views_left: number;
}

export interface NoteMeta {
  views_left: number;
  expires_at: string;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class NotesApi {
  private readonly http = inject(HttpClient);

  create(body: CreateNoteRequest): Promise<CreatedNote> {
    return firstValueFrom(this.http.post<CreatedNote>('/notes', body));
  }

  /** Consumes one view. */
  read(code: string): Promise<NoteContent> {
    return firstValueFrom(this.http.get<NoteContent>(`/notes/${encodeURIComponent(code)}`));
  }

  meta(code: string): Promise<NoteMeta> {
    return firstValueFrom(this.http.get<NoteMeta>(`/notes/${encodeURIComponent(code)}/meta`));
  }
}

/** The API's `error` code, or 'network' when no usable response came back. */
export function errorCode(err: unknown): string {
  if (err instanceof HttpErrorResponse && typeof err.error?.error === 'string') {
    return err.error.error;
  }
  return 'network';
}

const MESSAGES: Record<string, string> = {
  invalid_content: 'The note is empty or too large.',
  invalid_field: 'Views must be 1–100 and expiry between 1 minute and 7 days.',
  payload_too_large: 'The note is larger than 100 KB.',
  network: "Can't reach the server. Check your connection and try again.",
};

export function errorMessage(err: unknown): string {
  return MESSAGES[errorCode(err)] ?? 'Something went wrong. Please try again.';
}
