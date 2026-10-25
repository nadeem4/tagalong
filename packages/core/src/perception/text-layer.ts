/**
 * What a window's text does not say.
 *
 * An accessibility tree carries what an application chooses to publish, which is not the
 * same as what is on the screen. Editors, terminals, PDF viewers and canvas apps draw
 * their own glyphs and publish only menus and tab titles. A read of one comes back with a
 * few hundred characters that look like a complete answer, and a pet that treats them as
 * one will tell the user their file is empty.
 *
 * These notes live here rather than in the host because they are about meaning, not about
 * the operating system — the same split that puts window classification in this package
 * and enumeration in `bodies/desktop`. Contains textLayerNotes and THIN_TEXT_CHARS.
 */

/** The reading a set of notes is derived from. */
export interface TextLayerReading {
  processName: string;
  state: 'foreground' | 'background' | 'minimized';
  browser: boolean;
  /** Characters actually returned, after any cap was applied. */
  textLength: number;
  truncated: boolean;
}

/**
 * Below this many characters, a window is assumed to have published its chrome and not its
 * contents.
 *
 * Measured rather than chosen: a minimized editor on the development machine returned 456
 * characters — its menu bar and tab titles, none of the open file. Five hundred sits just
 * above that, so the case the number exists for falls on the warned side of it.
 *
 * It is a heuristic and will sometimes warn about a genuinely near-empty window. That
 * error is cheap; the opposite one, staying silent while a pet reports an editor as empty,
 * is not.
 */
export const THIN_TEXT_CHARS = 500;

/** `Code.exe` reads as `Code` in a sentence. */
function displayName(processName: string): string {
  return processName.replace(/\.exe$/i, '');
}

/**
 * Builds the caveats that belong with one reading, most consequential first.
 *
 * Returns an empty array when a window published plenty and nothing needs qualifying. A
 * note attached to every read is a note the pet learns to skip past, and it is paid for in
 * tokens every time.
 */
export function textLayerNotes(reading: TextLayerReading): string[] {
  const notes: string[] = [];
  const name = displayName(reading.processName);

  if (reading.textLength === 0) {
    notes.push(
      `${name} published no text through the accessibility tree. Tagalong cannot read this ` +
        `window's contents — that is not the same as the window being empty, and saying it is ` +
        `empty would be wrong.`,
    );
  } else if (reading.textLength < THIN_TEXT_CHARS) {
    notes.push(
      `${name} published only ${reading.textLength} characters, which for most applications is ` +
        `menus and tab titles rather than content. Editors, terminals and viewers draw their own ` +
        `text and expose little this way, so treat this as a hint about the window, not as ` +
        `everything it is showing.`,
    );
  }

  if (reading.browser) {
    notes.push(
      `This is a browser window, and the text above covers its active tab only. Tabs the user ` +
        `is not looking at are not readable from the desktop; reading those needs the Tagalong ` +
        `browser extension.`,
    );
  }

  if (reading.truncated) {
    notes.push(
      `This is the beginning of the window's text, not all of it. Ask again with a larger ` +
        `character budget if the part you need is further down.`,
    );
  }

  return notes;
}
