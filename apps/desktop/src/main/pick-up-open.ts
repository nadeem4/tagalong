import type { PickUpItem, PickUpReadyParams } from '@tagalong/protocol';

/** How main reopens one project: an editor link for `shell.openExternal`, or a folder for `openPath`. */
export type PickUpOpen = { external: string } | { path: string };

/**
 * VS Code and Cursor reopen a folder by their own link, which restores the files the editor
 * had open, so Tagalong never rebuilds that. Any other editor: the folder, in Explorer.
 * A hand-off opens nothing here: Brief again goes through the engine.
 */
export function openFor(item: PickUpItem): PickUpOpen | null {
  if (item.kind !== 'project') return null;
  if (item.editor === 'other') return { path: item.path };
  const url = item.path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
  // Keep the drive's colon readable: `C:/x`, as the editors write it.
  return { external: `${item.editor}://file/${url.replace(/^([A-Za-z])%3A/, '$1:')}` };
}

/**
 * The projects main may open: only those in the pick-up last shown, looked up by item id.
 * The renderer names an id, never a path, so it cannot ask main to open anything else.
 */
export class PickUpAllowlist {
  #items = new Map<string, PickUpItem>();

  set(pickUp: PickUpReadyParams): void {
    this.#items = new Map(pickUp.items.map((item) => [item.id, item]));
  }

  clear(): void {
    this.#items.clear();
  }

  open(itemId: string): PickUpOpen | null {
    const item = this.#items.get(itemId);
    return item === undefined ? null : openFor(item);
  }
}

/**
 * A pick-up found while the bubble is open waits for the bubble to hide. Only one waits: a
 * newer one replaces it, so one hide shows one card, and dropping it (pick-up switched off)
 * leaves nothing stale to show.
 */
export class PickUpWaiting {
  #waiting: PickUpReadyParams | null = null;

  /** Holds this pick-up. True when nothing was waiting, so the caller listens for the hide. */
  hold(pickUp: PickUpReadyParams): boolean {
    const first = this.#waiting === null;
    this.#waiting = pickUp;
    return first;
  }

  /** The pick-up to show now the bubble has hidden, if one still waits. */
  release(): PickUpReadyParams | null {
    const pickUp = this.#waiting;
    this.#waiting = null;
    return pickUp;
  }

  drop(): void {
    this.#waiting = null;
  }
}
