/**
 * Drop it on Scout: a file, an image, a link or selected text dropped on the figure.
 *
 * The drop only names the item. Nothing is read from disk until the person presses a
 * button on the card, and then only that one item: `dropDesk` holds it until `take`.
 * Contains offerFor, readDrop, dropDesk, registerDropIpc and guardNavigation.
 */

import { posix, win32 } from 'node:path';
import { secretFileRule } from '@tagalong/core';
import { MAX_SELECTION_CHARS } from '@tagalong/protocol';
import type { CapturedImage, Dropped } from '@tagalong/protocol';
import type { DropOffer } from '@tagalong/ui';
import { MAX_SCREENSHOT_LONG_SIDE } from './context';
import type { IpcHandle } from './ipc/handle';
import { IPC } from '../shared/ipc';

/** A text file past this is named with its size, not read. */
export const MAX_TEXT_FILE_BYTES = 1024 * 1024;
/** An image past this is named with its size, not decoded. */
export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;

/** How long a dropped item waits for a button on its card before it is let go, unread. */
export const DROP_HOLD_MS = 10 * 60_000;

export const SECRET_REFUSAL = 'Looks like a secrets file: not read, not passed on.';

// What Electron's nativeImage decodes everywhere. A WebP or a GIF it cannot, so those go
// to an expert as files.
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'rst',
  'log',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sh',
  'ps1',
  'bat',
  'sql',
  'vue',
  'svelte',
]);

/** The disk, as `readDrop` uses it: Node's fs and Electron's nativeImage in the app. */
export interface DropFs {
  /** In bytes; rejects when the file is missing. */
  size(path: string): Promise<number>;
  readText(path: string): Promise<string>;
  /** Decodes the picture and scales it to a PNG whose long side is at most `maxLongSide`. */
  readImage(path: string, maxLongSide: number): Promise<CapturedImage>;
}

/** The last part of a path, Windows or POSIX, whichever machine this runs on. */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function isTextFile(name: string): boolean {
  return TEXT_EXTENSIONS.has(extension(name));
}

/** The first web address in a `text/uri-list`, whose lines starting with `#` are comments. */
function webLink(uriList: string | undefined): string | null {
  const first = (uriList ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));
  if (first === undefined) return null;
  try {
    const { protocol } = new URL(first);
    return protocol === 'http:' || protocol === 'https:' ? first : null;
  } catch {
    return null;
  }
}

/**
 * The card for a drop, from what the renderer sent: a file first, then a link, then text.
 * Reads nothing. Null for a drop with nothing usable in it, or a malformed one.
 */
export function offerFor(item: unknown): DropOffer | null {
  if (typeof item !== 'object' || item === null) return null;
  const { paths, uri, text } = item as Record<string, unknown>;
  if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) return null;

  const path = (paths as string[])[0];
  if (path !== undefined) {
    if (!win32.isAbsolute(path) && !posix.isAbsolute(path)) return null;
    const name = fileName(path);
    if (secretFileRule(name) !== null) return { refusal: SECRET_REFUSAL };
    const image = IMAGE_EXTENSIONS.has(extension(name));
    return {
      dropped: { kind: image ? 'image' : 'file', name, path },
      explain: image || isTextFile(name),
    };
  }

  const link = webLink(typeof uri === 'string' ? uri : undefined);
  if (link !== null) {
    return { dropped: { kind: 'link', text: link.slice(0, MAX_SELECTION_CHARS) }, explain: false };
  }

  if (typeof text === 'string' && text.trim().length > 0) {
    return { dropped: { kind: 'text', text: text.slice(0, MAX_SELECTION_CHARS) }, explain: true };
  }
  return null;
}

export type DropRead = { ok: true; dropped: Dropped } | { ok: false; error: string };

/**
 * Reads the one item the person chose to send: a text file's text, an image as a PNG,
 * any other file by name, path and size. Text and a link pass through. Never throws.
 */
export async function readDrop(dropped: Dropped, fs: DropFs): Promise<DropRead> {
  const path = dropped.path;
  if (path === undefined) return { ok: true, dropped };
  const name = dropped.name ?? fileName(path);
  // Judged by the path itself, the file that would be opened, not by the name it came with.
  if (secretFileRule(fileName(path)) !== null || secretFileRule(name) !== null) {
    return { ok: false, error: SECRET_REFUSAL };
  }

  try {
    const size = await fs.size(path);
    const named: Dropped = { kind: 'file', name, path, size };
    if (dropped.kind === 'image') {
      if (size > MAX_IMAGE_FILE_BYTES) return { ok: true, dropped: named };
      const image = await fs.readImage(path, MAX_SCREENSHOT_LONG_SIDE);
      return { ok: true, dropped: { ...named, kind: 'image', image } };
    }
    if (!isTextFile(name) || size > MAX_TEXT_FILE_BYTES) return { ok: true, dropped: named };
    const text = await fs.readText(path);
    return { ok: true, dropped: { ...named, text: text.slice(0, MAX_SELECTION_CHARS) } };
  } catch {
    return { ok: false, error: `Couldn’t read ${name}.` };
  }
}

/**
 * Holds the item last dropped until a button on its card takes it, once, within
 * `DROP_HOLD_MS`. A refusal holds nothing, so a secrets file can never be sent by pressing
 * a button on an older card, and a card left open or cancelled cannot be sent much later.
 */
export function dropDesk(fs: DropFs, now: () => number = Date.now) {
  let held: { dropped: Dropped; at: number } | null = null;
  return {
    offer(item: unknown): DropOffer | null {
      const offer = offerFor(item);
      held = offer !== null && 'dropped' in offer ? { dropped: offer.dropped, at: now() } : null;
      return offer;
    },
    async take(): Promise<Dropped> {
      const taken = held;
      held = null;
      if (taken === null) throw new Error('Nothing was dropped on Scout to send.');
      if (now() - taken.at > DROP_HOLD_MS) {
        throw new Error('That drop has been waiting too long. Drop it on me again.');
      }
      const dropped = taken.dropped;
      const read = await readDrop(dropped, fs);
      if (!read.ok) throw new Error(read.error);
      return read.dropped;
    },
  };
}

export interface DropIpcDeps {
  desk: Pick<ReturnType<typeof dropDesk>, 'offer'>;
  /** Whether the call came from the figure's window, the only one things are dropped on. */
  fromAvatar: (event: unknown) => boolean;
  /** Opens the bubble on the card for the drop. */
  show: (offer: DropOffer) => void;
}

/** A drop on the figure: name the item and open the bubble on its card. Nothing is read. */
export function registerDropIpc(handle: IpcHandle, deps: DropIpcDeps): void {
  handle(IPC.dropOnPet, (event, item: unknown) => {
    if (!deps.fromAvatar(event)) throw new Error('Things are dropped only on the figure.');
    const offer = deps.desk.offer(item);
    if (offer !== null) deps.show(offer);
  });
}

/**
 * A file dropped on a window navigates it to that file unless something stops it. The
 * figure stops it in the page; this is the backstop for a drop that lands anywhere else.
 */
export function guardNavigation(contents: {
  on(event: 'will-navigate', listener: (event: { preventDefault: () => void }) => void): unknown;
}): void {
  contents.on('will-navigate', (event) => event.preventDefault());
}
