/** Tests for textLayerNotes. */
import { describe, expect, it } from 'vitest';

import { THIN_TEXT_CHARS, textLayerNotes } from './text-layer-notes';

const reading = {
  processName: 'Code.exe',
  state: 'background' as const,
  browser: false,
  textLength: 5_000,
  truncated: false,
};

/** True when some note says the window may be holding back more than it published. */
function warnsAboutIncompleteness(notes: readonly string[]): boolean {
  return notes.some((note) => /not the same|rather than|only|cannot read/i.test(note));
}

describe('textLayerNotes', () => {
  it('says nothing when a window published plenty of text', () => {
    // A note on every read is a note the pet learns to skip, and it is paid for every
    // time. Silence is the signal that nothing needs qualifying.
    expect(textLayerNotes(reading)).toEqual([]);
  });

  it('warns when a window published nothing at all', () => {
    const notes = textLayerNotes({ ...reading, textLength: 0 });

    expect(notes.length).toBeGreaterThan(0);
    expect(warnsAboutIncompleteness(notes)).toBe(true);
    // The distinction that matters: unreadable, not empty. A pet told an editor is empty
    // will answer that the file is empty.
    expect(notes.join(' ')).toMatch(/not that the window is empty|cannot read/i);
  });

  it('warns when a window published only a sliver, as a minimized editor does', () => {
    // Measured: a minimized editor returned 456 characters, all window chrome.
    const notes = textLayerNotes({ ...reading, textLength: 456 });

    expect(notes.length).toBeGreaterThan(0);
    expect(warnsAboutIncompleteness(notes)).toBe(true);
  });

  it('draws the sliver line where the measurement put it', () => {
    expect(textLayerNotes({ ...reading, textLength: THIN_TEXT_CHARS - 1 })).not.toEqual([]);
    expect(textLayerNotes({ ...reading, textLength: THIN_TEXT_CHARS })).toEqual([]);
  });

  it('names the process in the warning, so the pet can say which window it means', () => {
    const notes = textLayerNotes({
      ...reading,
      processName: 'WindowsTerminal.exe',
      textLength: 12,
    });

    expect(notes.join(' ')).toContain('WindowsTerminal');
  });

  it('tells the pet a browser window is one tab, and where the others live', () => {
    const notes = textLayerNotes({ ...reading, browser: true });

    expect(notes.join(' ')).toMatch(/active tab/i);
    expect(notes.join(' ')).toMatch(/extension|browser host/i);
  });

  it('does not claim other tabs are readable', () => {
    const notes = textLayerNotes({ ...reading, browser: true }).join(' ');

    expect(notes).not.toMatch(/all tabs|every tab/i);
  });

  it('says when the text is a beginning rather than the whole window', () => {
    const notes = textLayerNotes({ ...reading, truncated: true });

    expect(notes.join(' ')).toMatch(/beginning|first/i);
  });

  it('stacks every caveat that applies', () => {
    // A truncated read of a browser window that published almost nothing is all three at
    // once, and dropping any one of them leaves the pet with a wrong picture.
    const notes = textLayerNotes({
      ...reading,
      browser: true,
      textLength: 40,
      truncated: true,
    });

    expect(notes.length).toBe(3);
  });

  it('puts the emptiness warning first, because it changes what the text means', () => {
    const notes = textLayerNotes({ ...reading, browser: true, textLength: 0, truncated: true });

    expect(notes[0]).toMatch(/no text|cannot read/i);
  });

  it('never returns an empty string as a note', () => {
    // The protocol requires each note to be non-empty; a blank one would fail validation
    // at the socket and cost the pet the whole read.
    for (const textLength of [0, 1, 456, 5_000]) {
      for (const truncated of [true, false]) {
        for (const browser of [true, false]) {
          const notes = textLayerNotes({ ...reading, textLength, truncated, browser });
          expect(notes.every((note) => note.trim().length > 0)).toBe(true);
        }
      }
    }
  });
});
