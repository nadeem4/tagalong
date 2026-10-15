import type { CapturedImage, ContextSnapshotPatch, WindowEntry } from '@tagalong/protocol';
import type { SightRecorder, SightRow } from '../memory/sight-log';
import type { PerceptionHost } from './host';

/**
 * Wraps a host so every read it answers writes one row to the log of what Scout saw.
 *
 * One wrapper at the host, as `guardBrain` sits at the provider: the tools, the watches,
 * keep-an-eye and the browser routing all read through `hosts()`, so a read path added
 * later is logged without anyone remembering to. Only metadata is recorded. A read the
 * host refused (`blocked`) or that returned nothing is not logged, because nothing was read.
 *
 * A host answers reads with a `windowId` only, so the wrapper keeps the last window list it
 * saw to name the app and title. Every other property — `id`, `host`, `notify` — passes
 * through untouched, so a router that tells hosts apart still can.
 */
export function recordSight<H extends PerceptionHost>(host: H, log: SightRecorder): H {
  const windows = new Map<string, WindowEntry>();
  // Only the latest list: a long session opens thousands of windows, and a closed one's
  // title has no business outliving it here.
  const remember = (list: readonly WindowEntry[] | undefined): void => {
    if (list === undefined) return;
    windows.clear();
    for (const window of list) windows.set(window.id, window);
  };
  const named = (windowId: string): Pick<SightRow, 'app' | 'title'> => {
    const window = windows.get(windowId);
    return window === undefined ? {} : { app: window.processName, title: window.title };
  };
  const record = (row: SightRow | null): void => {
    if (row === null) return;
    try {
      log.record(row);
    } catch (error) {
      // The log must never cost the person the look they asked for.
      console.warn('[sight-log] could not write a row:', error);
    }
  };

  const wrapped: Partial<PerceptionHost> = {
    capture: async (what) => {
      const snapshot = await host.capture(what);
      remember(snapshot.windows);
      record(snapshotRow(snapshot));
      return snapshot;
    },
  };
  if (host.listWindows !== undefined) {
    wrapped.listWindows = async () => {
      const result = await host.listWindows!();
      remember(result.windows);
      record({ kind: 'listed_windows', windows: result.windows.length });
      return result;
    };
  }
  if (host.readText !== undefined) {
    wrapped.readText = async (params) => {
      const result = await host.readText!(params);
      if (result.blocked === undefined) {
        record({
          kind: 'read_text',
          ...named(result.windowId),
          chars: result.text.length,
          source: result.source,
        });
      }
      return result;
    };
  }
  if (host.captureWindow !== undefined) {
    wrapped.captureWindow = async (params) => {
      const result = await host.captureWindow!(params);
      if (result.blocked === undefined && result.image !== undefined) {
        record({ kind: 'screenshot', ...named(result.windowId), images: 1 });
      }
      return result;
    };
  }
  if (host.captureRegion !== undefined) {
    wrapped.captureRegion = async (params) => {
      const result = await host.captureRegion!(params);
      record({ kind: 'screenshot', images: 1 });
      return result;
    };
  }
  if (host.recall !== undefined) {
    wrapped.recall = async (params) => {
      const result = await host.recall!(params);
      if (result.frames.length > 0) {
        const focused = result.focusedWindow;
        record({
          kind: 'screenshot',
          ...(focused === undefined ? {} : { app: focused.processName, title: focused.title }),
          images: result.frames.length,
        });
      }
      return result;
    };
  }
  if (host.diff !== undefined) {
    wrapped.diff = async (params) => {
      const result = await host.diff!(params);
      // A watch polls with no pictures: only a number comes back, so nothing was seen.
      const images = count(result.before, result.after);
      if (images > 0) record({ kind: 'screenshot', images });
      return result;
    };
  }

  return new Proxy(host, {
    get(target, property) {
      if (property in wrapped) return wrapped[property as keyof PerceptionHost];
      // Read on the host itself and bound to it, so a class with private fields still works.
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  });
}

/**
 * The engine's `hosts()`, with each host wrapped once. The same session always comes back
 * as the same wrapper, so code that compares hosts between calls keeps working.
 */
export function sightedHosts<H extends PerceptionHost>(
  sessions: () => readonly H[],
  log: SightRecorder,
): () => readonly H[] {
  const wrapped = new WeakMap<H, H>();
  return () =>
    sessions().map((session) => {
      let host = wrapped.get(session);
      if (host === undefined) {
        host = recordSight(session, log);
        wrapped.set(session, host);
      }
      return host;
    });
}

/** The snapshot a hotkey ask arrives with: read by the host before any host method runs. */
export function recordSnapshot(
  log: SightRecorder,
  snapshot: ContextSnapshotPatch | undefined,
): void {
  if (snapshot === undefined) return;
  const row = snapshotRow(snapshot);
  if (row === null) return;
  try {
    log.record(row);
  } catch (error) {
    console.warn('[sight-log] could not write a row:', error);
  }
}

function count(...images: (CapturedImage | undefined)[]): number {
  return images.filter((image) => image !== undefined).length;
}

/**
 * A capture as one row: pictures make it a screenshot; otherwise text it read (selection,
 * clipboard, page text) makes it a read; otherwise a window list. An identity check, which
 * names the front window and reads nothing in it, writes no row.
 */
export function snapshotRow(snapshot: ContextSnapshotPatch): SightRow | null {
  const where =
    snapshot.app === undefined
      ? {}
      : {
          app: snapshot.app.name,
          ...(snapshot.app.windowTitle === undefined ? {} : { title: snapshot.app.windowTitle }),
        };
  const images =
    count(snapshot.screenshot, snapshot.composite) +
    (snapshot.displays ?? []).filter((display) => display.image !== undefined).length;
  if (images > 0) return { kind: 'screenshot', ...where, images };
  const chars =
    (snapshot.selection?.length ?? 0) +
    (snapshot.clipboard?.length ?? 0) +
    (snapshot.page?.text.length ?? 0);
  if (chars > 0) return { kind: 'read_text', ...where, chars };
  if (snapshot.windows !== undefined && snapshot.windows.length > 0) {
    return { kind: 'listed_windows', windows: snapshot.windows.length };
  }
  return null;
}
