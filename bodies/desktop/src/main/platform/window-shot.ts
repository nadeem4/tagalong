/**
 * Answers perception.captureWindow: a screenshot of one listed window, checked against the
 * classified inventory before any pixel is read. Contains lookAtWindowWith.
 */

import type { CaptureBlock, WindowEntry } from '@tagalong/ui/shapes';
import { handleOf } from './window-list';
import type { CapturedImage } from './index';

/** Exactly what `perception.captureWindow` answers with. */
export interface LookAtWindowAnswer {
  windowId: string;
  image?: { mime: 'image/png'; base64: string; width: number; height: number };
  blocked?: CaptureBlock;
  notes?: string[];
}

interface LookAtWindowDeps {
  /** The inventory, already classified against the blind spots and the exclusion list. */
  listWindows: () => Promise<readonly WindowEntry[]>;
  captureWindowImage: (handle: number, maxLongSide: number) => Promise<CapturedImage | null>;
}

/**
 * Answers `perception.captureWindow`: a screenshot of one listed window, in front or not.
 *
 * Checked against the classified inventory before any pixel is read, like a text read, so
 * a blind spot is refused rather than captured and thrown away. Every miss is an answer
 * with a note, never an exception: the model can name a window that closed a moment ago.
 */
export async function lookAtWindowWith(
  deps: LookAtWindowDeps,
  params: { windowId: string; maxLongSide: number },
): Promise<LookAtWindowAnswer> {
  const { windowId } = params;
  const target = (await deps.listWindows()).find((window) => window.id === windowId);
  if (target === undefined) {
    return {
      windowId,
      notes: [
        `There is no window ${windowId} open. It may have closed since the window list was ` +
          'taken. Ask for the list again and pick from what it names.',
      ],
    };
  }
  if (target.blocked !== undefined) {
    return {
      windowId,
      blocked: target.blocked,
      notes: [
        `This window is a blind spot, matched by ${target.blocked.entry}. Tagalong did not ` +
          'look at it and will not. Say that plainly rather than guessing at what it shows.',
      ],
    };
  }
  if (target.state === 'minimized') {
    return {
      windowId,
      notes: [
        'This window is minimized, so Windows draws nothing to photograph. Try ' +
          'read_window_text on it, or ask the person to restore it.',
      ],
    };
  }

  const handle = handleOf(target.id);
  const image = handle === null ? null : await deps.captureWindowImage(handle, params.maxLongSide);
  if (image === null) {
    return {
      windowId,
      notes: ['Tagalong could not photograph this window. Try read_window_text instead.'],
    };
  }
  return { windowId, image: { mime: 'image/png', ...image } };
}
