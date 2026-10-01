import { Component, effect, inject, signal } from '@angular/core';
import { CreateNote } from './create-note/create-note';
import { HowItWorks } from './how-it-works/how-it-works';
import { NoteLink } from './note-link';
import { OpenNote } from './open-note/open-note';

@Component({
  imports: [CreateNote, OpenNote, HowItWorks],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private readonly link = inject(NoteLink);

  protected readonly tab = signal<'create' | 'open'>('create');

  constructor() {
    // Arriving with a note link in the URL goes straight to the open view.
    effect(() => {
      if (this.link.code()) this.tab.set('open');
    });
  }

  protected showCreate(): void {
    this.link.clear();
    this.tab.set('create');
  }
}
