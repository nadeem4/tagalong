import { THIN_TEXT_CHARS, textLayerNotes } from '@tagalong/core';
import type { WindowEntry } from '@tagalong/protocol';

import type { TextLayerProvider } from './text-layer';
import { handleOf } from './window-list';

/** Exactly what `perception.readText` answers with. */
export interface ReadTextAnswer {
  windowId: string;
  text: string;
  truncated: boolean;
  source: 'uia' | 'ocr';
  blocked?: WindowEntry['blocked'];
  notes?: string[];
}

export interface ReadWindowTextDeps {
  textLayer: TextLayerProvider;
  /** The inventory, already classified against the exclusion list. */
  listWindows: () => Promise<readonly WindowEntry[]>;
  /**
   * The text in a picture of the window, for apps that draw their own text (terminals,
   * editors) and publish little to the text layer. Absent where there is no recogniser.
   */
  readPicture?: (handle: number) => Promise<string>;
}

export interface ReadWindowTextParams {
  /** Absent means the foreground window. */
  windowId?: string;
  maxChars: number;
}

/** A refusal or a miss: an answer with no text, and a note saying why there is none. */
function nothing(
  windowId: string,
  notes: string[],
  blocked?: WindowEntry['blocked'],
): ReadTextAnswer {
  return {
    windowId,
    text: '',
    truncated: false,
    source: 'uia',
    ...(blocked === undefined ? {} : { blocked }),
    notes,
  };
}

/**
 * Answers `perception.readText` for one window.
 *
 * The exclusion check happens against the inventory *before* the read, not after it. A
 * read that runs and is then discarded has already pulled the vault's contents into this
 * process's memory, which is the thing the exclusion list exists to prevent. The
 * inventory is the right place to check because it is already classified, so there is one
 * matcher rather than two that can disagree.
 *
 * Every failure is an answer rather than an exception. The model can name a window id it
 * invented, or one that closed between the inventory and the read, and the honest reply
 * is an empty read that says so — not a turn that dies.
 */
export async function readWindowTextWith(
  deps: ReadWindowTextDeps,
  params: ReadWindowTextParams,
): Promise<ReadTextAnswer> {
  const windows = await deps.listWindows();
  const target =
    params.windowId === undefined
      ? windows.find((window) => window.state === 'foreground')
      : windows.find((window) => window.id === params.windowId);

  if (target === undefined) {
    const named = params.windowId ?? '(the foreground window)';
    return nothing(params.windowId ?? '', [
      params.windowId === undefined
        ? 'Windows reports no foreground window right now, so there was nothing to read. This ' +
          'happens on a locked session, behind a UAC prompt, and in full-screen games.'
        : `There is no window ${named} open. It may have been closed since the window list was ` +
          `taken. Ask for the list again and pick from what it names.`,
    ]);
  }

  if (target.blocked !== undefined) {
    return nothing(
      target.id,
      [
        `This window is on the user's capture exclusion list, matched by ${target.blocked.entry}. ` +
          `Tagalong did not read it and will not. Say that plainly rather than guessing at what ` +
          `it contains.`,
      ],
      target.blocked,
    );
  }

  const handle = handleOf(target.id);
  if (handle === null) {
    return nothing(target.id, [
      `${target.id} is not a window id this host issued, so there was nothing to read.`,
    ]);
  }

  const reading = await deps.textLayer.readWindowText(handle, params.maxChars);

  // A read that never ran is not a window with nothing in it. "Code published no text
  // through the accessibility tree" is a claim about the window; when the helper returned
  // zero bytes the only honest claim is about Tagalong. A pet repeating the first version
  // tells the user their file is empty.
  if (reading.failure !== undefined) {
    return nothing(target.id, [
      `Tagalong could not read this window: the text helper ${
        reading.failure === 'no-output' ? 'returned nothing' : 'returned output that made no sense'
      }. This says nothing about what is in the window — do not describe it as empty. Trying ` +
        `again may work.`,
    ]);
  }

  // Thin text from a window that is on screen: read what it shows instead. Terminals and
  // editors draw their own text, so the picture often holds far more than the text layer.
  if (
    deps.readPicture !== undefined &&
    reading.text.length < THIN_TEXT_CHARS &&
    target.state !== 'minimized'
  ) {
    const seen = (await deps.readPicture(handle).catch(() => '')).trim();
    if (seen.length > reading.text.length) {
      const truncated = seen.length > params.maxChars;
      return {
        windowId: target.id,
        text: seen.slice(0, params.maxChars),
        truncated,
        source: 'ocr',
        notes: [
          'Read from a picture of the window, because it publishes little text otherwise. It ' +
            'covers only what the window shows on screen, and words may be misread.',
          ...(truncated ? ['This is the beginning of what was read, not all of it.'] : []),
        ],
      };
    }
  }

  const notes = textLayerNotes({
    processName: target.processName,
    state: target.state,
    browser: target.browser,
    textLength: reading.text.length,
    truncated: reading.truncated,
  });

  return {
    windowId: target.id,
    text: reading.text,
    truncated: reading.truncated,
    source: 'uia',
    // Omitted rather than empty: the protocol requires each note to be a non-empty string,
    // and an empty array is noise in a result the pet reads on every look.
    ...(notes.length === 0 ? {} : { notes }),
  };
}
