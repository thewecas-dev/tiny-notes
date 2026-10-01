import { Component } from '@angular/core';

@Component({
  selector: 'app-how-it-works',
  templateUrl: './how-it-works.html',
})
export class HowItWorks {
  protected readonly steps = [
    {
      title: 'Write it',
      text: 'Paste your text, then choose how many times it can be viewed and how long it should last.',
    },
    {
      title: 'Share the link',
      text: 'You get a short link with a random 8-character code. Send it to the person who needs it.',
    },
    {
      title: 'It disappears',
      text: 'After the last view, or when time runs out, the note is deleted. Whichever comes first.',
    },
  ];

  protected readonly facts = [
    {
      title: 'Opening a link is free',
      text: 'The link shows how many views are left and when the note expires. Only pressing Reveal uses a view.',
    },
    {
      title: 'One view means one reader',
      text: 'If two people press Reveal on a one-view note at the same moment, exactly one of them gets it.',
    },
    {
      title: 'Gone is gone',
      text: 'A viewed or expired note cannot be recovered by anyone. A used, expired or mistyped link all look the same.',
    },
    {
      title: 'Limits',
      text: 'Plain text up to 100 KB, 1 to 100 views, and a lifetime from 1 minute to 7 days.',
    },
    {
      title: 'The link is the key',
      text: 'There are no accounts or passwords. Anyone who has the link can reveal the note, so send it somewhere you trust.',
    },
    {
      title: 'Not encrypted yet',
      text: 'Notes are stored as plain text on the server until they are deleted. Encryption is planned for a later version.',
    },
  ];
}
