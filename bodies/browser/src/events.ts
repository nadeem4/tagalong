/**
 * The two facts the browser volunteers to the brain: the tab in front and finished downloads.
 * URLs lose their query and fragment (tokens live there) and the tab fact is throttled so
 * flicking through tabs does not flood the brain.
 */

export const TAB_THROTTLE_MS = 2_000;

/** Origin plus path of an http(s) URL; anything else gives '' so it is never sent. */
export function stripUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin + u.pathname;
  } catch {
    return '';
  }
}

interface TabReporterOptions {
  /** Returns false when the fact could not go out (offline), so the next change tries again. */
  send: (name: string, data: unknown) => boolean;
  now: () => number;
}

export function createTabReporter(
  options: TabReporterOptions,
): (tab: { title: string; url: string }) => void {
  let lastKey = '';
  let lastAt = Number.NEGATIVE_INFINITY;
  let pending: { title: string; url: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function trySend(tab: { title: string; url: string }): void {
    const key = `${tab.title}\n${tab.url}`;
    if (key === lastKey) return;
    if (options.send('tab', tab)) {
      lastKey = key;
      lastAt = options.now();
    }
  }

  function flush(): void {
    timer = null;
    const tab = pending;
    pending = null;
    if (tab) trySend(tab);
  }

  return (tab) => {
    const url = stripUrl(tab.url);
    if (!url) return;
    const item = { title: tab.title, url };
    const wait = lastAt + TAB_THROTTLE_MS - options.now();
    if (wait <= 0 && !timer) {
      trySend(item);
      return;
    }
    pending = item;
    timer ??= setTimeout(flush, Math.max(wait, 0));
  };
}

/** A finished or failed download as a fact; the folder is dropped so only the file name leaves. */
export function downloadEvent(item: {
  filename: string;
  state: string;
}): { name: string; state: 'complete' | 'interrupted' } | null {
  if (item.state !== 'complete' && item.state !== 'interrupted') return null;
  const name = item.filename.split(/[\\/]/).pop() ?? '';
  if (name === '') return null;
  return { name, state: item.state };
}
