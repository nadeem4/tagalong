import { randomUUID } from 'node:crypto';
import { ContextSnapshot } from '@tagalong/protocol';
import type { ContextSnapshotPatch, PerceptionTarget } from '@tagalong/protocol';
import type { Platform } from './platform/index';

/** What the desktop host tells the engine it can perceive in Phase 1. */
export const DESKTOP_CAPABILITIES = ['selection', 'activeWindow', 'clipboard'] as const;

/**
 * Perception is best effort.
 *
 * A clipboard the OS briefly locked, or a window that closed between the hotkey and the
 * read, must not cost the user their whole ask — the pet can still answer with less.
 */
async function attempt<T>(what: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    console.warn(`[context] could not read ${what}:`, error);
    return null;
  }
}

/** Everything this host can see, packaged as the snapshot that rides along with an ask. */
export async function captureAskSnapshot(platform: Platform): Promise<ContextSnapshot> {
  const [selection, window] = await Promise.all([
    attempt('the selection', () => platform.captureSelection()),
    attempt('the active window', () => platform.getActiveWindow()),
  ]);

  return ContextSnapshot.parse({
    id: randomUUID(),
    capturedAt: new Date().toISOString(),
    host: 'desktop',
    ...(selection !== null && selection.length > 0 ? { selection } : {}),
    ...(window !== null
      ? { app: { name: window.appName, ...(window.title ? { windowTitle: window.title } : {}) } }
      : {}),
  });
}

/**
 * Answers the engine's perception.capture with just the targets it named. Screenshots are
 * Phase 2 and page text only ever comes from the extension, so both are silently absent.
 */
export async function capturePatch(
  platform: Platform,
  what: readonly PerceptionTarget[],
): Promise<ContextSnapshotPatch> {
  const patch: ContextSnapshotPatch = {};

  if (what.includes('selection')) {
    const selection = await attempt('the selection', () => platform.captureSelection());
    if (selection !== null && selection.length > 0) patch.selection = selection;
  }
  if (what.includes('clipboard')) {
    const clipboard = await attempt('the clipboard', () => platform.readClipboard());
    if (clipboard !== null) patch.clipboard = clipboard;
  }
  if (what.includes('activeWindow')) {
    const window = await attempt('the active window', () => platform.getActiveWindow());
    if (window !== null) {
      patch.app = { name: window.appName, ...(window.title ? { windowTitle: window.title } : {}) };
    }
  }
  return patch;
}
