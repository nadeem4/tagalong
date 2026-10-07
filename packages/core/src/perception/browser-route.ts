import type {
  CaptureExclusions,
  ContextSnapshot,
  ContextSnapshotPatch,
  HostCapability,
} from '@tagalong/protocol';
import { findCaptureBlock, type CaptureBlock } from './exclusions';
import { isBrowserProcess } from './inventory';
import type { PerceptionHost } from './host';

/**
 * How long the engine waits for the browser host before using the desktop's answer.
 *
 * Short because it sits in front of every ask made while a browser is focused. The
 * extension answers in tens of milliseconds when it can read the tab and fails fast when
 * Chrome refuses; the only case that reaches this limit is a service worker Chrome has
 * stopped, and the desktop's clipboard read is the right answer for that one.
 */
export const BROWSER_HOST_TIMEOUT_MS = 500;

/** The browser host is the one that can read page text; the desktop host never can. */
export function isBrowserHost(host: PerceptionHost): boolean {
  return host.capabilities.includes('pageText');
}

/**
 * The host to ask for something the desktop does best — window identity, the clipboard
 * trick — falling back to the browser host only when it is the sole one connected.
 * Connection order decides nothing: the desktop host is preferred wherever it sits.
 */
function desktopFor(
  hosts: readonly PerceptionHost[],
  capability: HostCapability,
): PerceptionHost | undefined {
  const able = hosts.filter((candidate) => candidate.capabilities.includes(capability));
  return able.find((candidate) => !isBrowserHost(candidate)) ?? able[0];
}

interface RouteOptions {
  hosts: readonly PerceptionHost[];
  exclusions: CaptureExclusions;
  timeoutMs?: number;
}

export type SelectionCapture =
  | {
      selection: string | undefined;
      app: ContextSnapshotPatch['app'];
      source: 'extension' | 'desktop';
    }
  | { blocked: CaptureBlock };

/**
 * Reads the selection from whichever host can read it exactly.
 *
 * In a browser that is the extension: it reads the DOM selection, where the desktop has
 * to press Ctrl+C and read the clipboard back. The extension is asked first and given
 * `BROWSER_HOST_TIMEOUT_MS`; a refusal or a silence falls back to the desktop. Exclusions
 * are checked against the desktop's view of the front window before either host reads.
 */
export async function captureSelection(options: RouteOptions): Promise<SelectionCapture | null> {
  const { hosts } = options;
  const identityHost = desktopFor(hosts, 'activeWindow');
  const identity = identityHost === undefined ? {} : await identityHost.capture(['activeWindow']);
  const block = findCaptureBlock(asActiveWindow(identity.app), options.exclusions);
  if (block !== null) return { blocked: block };

  const browser = hosts.find(isBrowserHost);
  const inBrowser =
    identity.app === undefined
      ? identityHost === browser
      : isBrowserProcess(identity.app.name) || identityHost === browser;
  if (browser !== undefined && inBrowser) {
    const read = await within(browser.capture(['selection']), options.timeoutMs);
    if (read !== null) return { selection: read.selection, app: identity.app, source: 'extension' };
  }

  const fallback = hosts.find(
    (candidate) => candidate.capabilities.includes('selection') && !isBrowserHost(candidate),
  );
  if (fallback === undefined) return null;
  const read = await fallback.capture(['selection']);
  return { selection: read.selection, app: identity.app, source: 'desktop' };
}

/**
 * Applies the browser rules to an ask before its turn starts.
 *
 * An ask from the side panel is checked against the exclusion list (see `unlessExcluded`).
 * And a desktop hotkey ask made in a browser is filled in with what only the extension can
 * read: the exact selection and the page's readable text.
 *
 * The desktop host captured the ask first — window identity and a clipboard-trick
 * selection — and already applied the exclusion list to that window. The extension then
 * reads the same tab; its answer replaces the clipboard copy only when it has one, and is
 * dropped whole if the tab it read turns out to be excluded. Anything slower than
 * `BROWSER_HOST_TIMEOUT_MS`, or any refusal, sends the ask exactly as the desktop made it.
 */
export async function browserContextFor(
  snapshot: ContextSnapshot | undefined,
  options: RouteOptions,
): Promise<ContextSnapshot | undefined> {
  if (snapshot === undefined) return snapshot;
  if (snapshot.host === 'extension') return unlessExcluded(snapshot, options.exclusions);
  if (snapshot.host !== 'desktop') return snapshot;
  if (snapshot.app === undefined || !isBrowserProcess(snapshot.app.name)) return snapshot;
  const browser = options.hosts.find(isBrowserHost);
  if (browser === undefined) return snapshot;

  const read = await within(
    browser.capture(['selection', 'pageText', 'activeWindow']),
    options.timeoutMs,
  );
  if (read === null) return snapshot;
  if (findCaptureBlock(asActiveWindow(read.app), options.exclusions) !== null) return snapshot;

  return {
    ...snapshot,
    ...(read.selection !== undefined && read.selection.length > 0
      ? { selection: read.selection }
      : {}),
    ...(read.page !== undefined ? { page: read.page } : {}),
  };
}

/**
 * The side panel reads its tab itself, so the exclusion list is applied here, where the
 * extension's snapshot first meets it: an excluded tab keeps only which tab it was, never
 * what was on it.
 */
function unlessExcluded(snapshot: ContextSnapshot, exclusions: CaptureExclusions): ContextSnapshot {
  if (findCaptureBlock(asActiveWindow(snapshot.app), exclusions) === null) return snapshot;
  return {
    id: snapshot.id,
    capturedAt: snapshot.capturedAt,
    host: snapshot.host,
    ...(snapshot.app !== undefined ? { app: snapshot.app } : {}),
  };
}

function asActiveWindow(app: ContextSnapshotPatch['app']) {
  if (app === undefined) return undefined;
  return {
    processName: app.name,
    ...(app.windowTitle === undefined ? {} : { title: app.windowTitle }),
  };
}

/** The host's answer, or null if it failed or took longer than the limit. */
async function within(
  answer: Promise<ContextSnapshotPatch>,
  timeoutMs = BROWSER_HOST_TIMEOUT_MS,
): Promise<ContextSnapshotPatch | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([answer.catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
