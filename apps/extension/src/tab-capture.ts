import type { ContextSnapshot, ContextSnapshotPatch, PerceptionTarget } from '@tagalong/protocol';
import type { PageReading } from './content/read-page';

export interface ActiveTab {
  id: number;
  url?: string;
  title?: string;
}

/** The Chrome calls a capture needs, injected so the mapping can be tested without Chrome. */
export interface TabAccess {
  /** The browser family, named the way the desktop's process list names it. */
  browser: string;
  activeTab(): Promise<ActiveTab | null>;
  /** Injects the page reader into the tab and runs it. */
  inject(tabId: number): Promise<PageReading>;
}

/**
 * Pages Chrome lets an extension script. Everything else — chrome://, the Web Store, other
 * extensions, view-source — refuses injection, and saying so beats a cryptic Chrome error.
 */
const READABLE_SCHEMES = new Set(['http:', 'https:', 'file:']);

/**
 * Answers `perception.capture` from the active tab: whichever of selection, page text and
 * tab identity were asked for. Targets this host does not have — a screenshot, the
 * displays — are left out, the same way a desktop host leaves out what it cannot read.
 */
export async function captureTab(
  targets: readonly PerceptionTarget[],
  access: TabAccess,
): Promise<ContextSnapshotPatch> {
  const wantsPage = targets.includes('selection') || targets.includes('pageText');
  const wantsIdentity = targets.includes('activeWindow');
  if (!wantsPage && !wantsIdentity) return {};

  const tab = await access.activeTab();
  if (tab === null) throw new Error('there is no active tab to read');

  const patch: ContextSnapshotPatch = {};
  if (wantsIdentity) {
    patch.app = {
      name: access.browser,
      ...(tab.title !== undefined && tab.title.length > 0 ? { windowTitle: tab.title } : {}),
    };
  }
  if (!wantsPage) return patch;

  if (tab.url !== undefined && !READABLE_SCHEMES.has(scheme(tab.url))) {
    throw new Error(`Chrome does not let extensions read ${tab.url}`);
  }
  const reading = await access.inject(tab.id);
  if (targets.includes('selection') && reading.selection.length > 0) {
    patch.selection = reading.selection;
  }
  if (targets.includes('pageText')) {
    patch.page = { url: reading.url, title: reading.title, text: reading.text };
  }
  return patch;
}

/** A whole snapshot for an ask from the side panel. */
export async function captureSnapshot(
  targets: readonly PerceptionTarget[],
  access: TabAccess,
  clock: { id: () => string; now: () => Date } = {
    id: () => crypto.randomUUID(),
    now: () => new Date(),
  },
): Promise<ContextSnapshot> {
  const patch = await captureTab(targets, access);
  return { ...patch, id: clock.id(), capturedAt: clock.now().toISOString(), host: 'extension' };
}

function scheme(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}
