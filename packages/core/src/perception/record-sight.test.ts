import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CapturedImage, WindowEntry } from '@tagalong/protocol';
import { migrate } from '../memory/db';
import { SightLog } from '../memory/sight-log';
import type { PerceptionHost } from './host';
import { recordSight, recordSnapshot, sightedHosts } from './record-sight';

const PIXELS = 'iVBORw0KGgoSECRETPIXELS';
const IMAGE: CapturedImage = { mime: 'image/png', base64: PIXELS, width: 10, height: 10 };
const BLOCK = { rule: 'processName' as const, entry: '1Password.exe' };

const window = (id: string, processName: string, title: string): WindowEntry => ({
  id,
  processName,
  title,
  state: 'background',
  browser: false,
});
const WINDOWS = [
  window('w1', 'Code.exe', 'main.ts - repo'),
  window('w2', 'chrome.exe', 'Release notes'),
];

/** A host with every method, each answering with a fixed reading. */
function fakeHost(overrides: Partial<PerceptionHost> = {}): PerceptionHost {
  return {
    capabilities: ['displays', 'textLayer', 'recall', 'screenshot', 'activeWindow'],
    capture: () =>
      Promise.resolve({
        app: { name: 'Code.exe', windowTitle: 'main.ts - repo' },
        screenshot: IMAGE,
      }),
    listWindows: () => Promise.resolve({ windows: WINDOWS }),
    readText: () =>
      Promise.resolve({ windowId: 'w1', text: 'const a = 1;', truncated: false, source: 'uia' }),
    captureWindow: () => Promise.resolve({ windowId: 'w2', image: IMAGE }),
    captureRegion: () => Promise.resolve({ image: IMAGE }),
    recall: () =>
      Promise.resolve({
        recording: true,
        frames: [{ displayId: 1, capturedAt: '2026-10-14T08:59:00.000Z', image: IMAGE }],
        windows: [],
        focusedWindow: { processName: 'Code.exe', title: 'main.ts - repo' },
      }),
    diff: () =>
      Promise.resolve({
        changeRatio: 0.2,
        afterAt: '2026-10-14T09:00:00.000Z',
        before: IMAGE,
        after: IMAGE,
      }),
    ...overrides,
  };
}

let db: Database.Database;
let sight: SightLog;

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db);
  sight = new SightLog(db, {
    days: () => 7,
    exclusions: () => ({ processNames: [], titlePatterns: [] }),
  });
});

afterEach(() => db.close());

const rows = () => sight.list();

describe('recordSight', () => {
  it('logs a window list by its count only', async () => {
    const host = recordSight(fakeHost(), sight);
    const listed = await host.listWindows!();
    expect(listed.windows).toHaveLength(2);
    expect(rows()).toMatchObject([{ kind: 'listed_windows', windows: 2 }]);
    expect(rows()[0]).not.toHaveProperty('title');
  });

  it('forgets a window the latest list no longer has, so the map never grows past one list', async () => {
    let listed = WINDOWS;
    const host = recordSight(
      fakeHost({ listWindows: () => Promise.resolve({ windows: listed }) }),
      sight,
    );
    await host.listWindows!();
    listed = [window('w9', 'notepad.exe', 'todo.txt')];
    await host.listWindows!();
    await host.readText!({ windowId: 'w1', maxChars: 100 });
    expect(rows()[0]).toMatchObject({ kind: 'read_text', chars: 12 });
    expect(rows()[0]).not.toHaveProperty('app');
    expect(rows()[0]).not.toHaveProperty('title');
  });

  it('names a read window from the last list, with the character count and source', async () => {
    const host = recordSight(fakeHost(), sight);
    await host.listWindows!();
    const read = await host.readText!({ windowId: 'w1', maxChars: 100 });
    expect(read.text).toBe('const a = 1;');
    expect(rows()[0]).toMatchObject({
      kind: 'read_text',
      app: 'Code.exe',
      title: 'main.ts - repo',
      chars: 12,
      source: 'uia',
    });
  });

  it('logs every way of taking a picture as a screenshot', async () => {
    const host = recordSight(fakeHost(), sight);
    await host.listWindows!();
    await host.capture(['screenshot']);
    await host.captureWindow!({ windowId: 'w2', maxLongSide: 800 });
    await host.captureRegion!({
      displayId: 1,
      rect: { x: 0, y: 0, width: 5, height: 5 },
      maxLongSide: 800,
    });
    await host.recall!({ secondsAgo: 60 });
    await host.diff!({ displayId: 1, sinceSeconds: 30 });

    const kinds = rows().map((r) => [r.kind, r.app, r.images]);
    expect(kinds).toEqual([
      ['screenshot', undefined, 2],
      ['screenshot', 'Code.exe', 1],
      ['screenshot', undefined, 1],
      ['screenshot', 'chrome.exe', 1],
      ['screenshot', 'Code.exe', 1],
      ['listed_windows', undefined, undefined],
    ]);
  });

  it('logs text a capture read, by its length', async () => {
    const host = recordSight(
      fakeHost({
        capture: () => Promise.resolve({ app: { name: 'chrome' }, selection: 'twelve chars' }),
      }),
      sight,
    );
    await host.capture(['selection']);
    expect(rows()).toMatchObject([{ kind: 'read_text', app: 'chrome', chars: 12 }]);
  });

  it('logs nothing for a look that read nothing: a blocked read, an identity check, a diff with no pictures', async () => {
    const host = recordSight(
      fakeHost({
        readText: () =>
          Promise.resolve({
            windowId: 'w1',
            text: '',
            truncated: false,
            source: 'uia',
            blocked: BLOCK,
          }),
        captureWindow: () => Promise.resolve({ windowId: 'w1', blocked: BLOCK }),
        capture: () => Promise.resolve({ app: { name: 'Code.exe', windowTitle: 'main.ts' } }),
        diff: () => Promise.resolve({ changeRatio: 0, afterAt: '2026-10-14T09:00:00.000Z' }),
        recall: () => Promise.resolve({ recording: false, frames: [], windows: [] }),
      }),
      sight,
    );
    await host.readText!({ maxChars: 100 });
    await host.captureWindow!({ windowId: 'w1', maxLongSide: 800 });
    await host.capture(['activeWindow']);
    await host.diff!({ displayId: 1, sinceSeconds: 30, includeImages: false });
    await host.recall!({ secondsAgo: 60 });
    expect(rows()).toEqual([]);
  });

  it('stores a blind spot or an excluded title as the app only', async () => {
    const host = recordSight(
      fakeHost({
        listWindows: () =>
          Promise.resolve({ windows: [window('w9', '1Password.exe', 'Bank login')] }),
        readText: () =>
          Promise.resolve({ windowId: 'w9', text: 'x', truncated: false, source: 'ocr' }),
      }),
      sight,
    );
    await host.listWindows!();
    await host.readText!({ windowId: 'w9', maxChars: 10 });
    expect(rows()[0]).toMatchObject({ kind: 'read_text', app: '1Password.exe' });
    expect(rows()[0]).not.toHaveProperty('title');
  });

  it('scrubs a key out of a title', async () => {
    const key = 'sk-' + 'ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    const host = recordSight(
      fakeHost({
        capture: () =>
          Promise.resolve({
            app: { name: 'Code.exe', windowTitle: `${key} - notes` },
            screenshot: IMAGE,
          }),
      }),
      sight,
    );
    await host.capture(['screenshot']);
    expect(JSON.stringify(rows())).not.toContain(key);
  });

  it('never puts pixels or read text in a row', async () => {
    const host = recordSight(fakeHost(), sight);
    await host.listWindows!();
    await host.capture(['screenshot']);
    await host.readText!({ windowId: 'w1', maxChars: 100 });
    const stored = JSON.stringify(db.prepare('SELECT * FROM sight_log').all());
    expect(stored).not.toContain(PIXELS);
    expect(stored).not.toContain('const a = 1;');
  });

  it('keeps the host as it was: capabilities, missing methods and failures', async () => {
    const bare: PerceptionHost = {
      capabilities: ['selection'],
      capture: () => Promise.reject(new Error('host gone')),
    };
    const host = recordSight(bare, sight);
    expect(host.capabilities).toEqual(['selection']);
    expect(host.listWindows).toBeUndefined();
    await expect(host.capture(['selection'])).rejects.toThrow('host gone');
    expect(rows()).toEqual([]);
  });

  it('carries the host identity fields a router reads', () => {
    const session = { ...fakeHost(), id: 's1', host: 'extension' as const };
    const host = recordSight(session, sight);
    expect(host.id).toBe('s1');
    expect(host.host).toBe('extension');
  });

  it('keeps the read working when the log cannot be written', async () => {
    const broken = {
      record: () => {
        throw new Error('disk full');
      },
    };
    const host = recordSight(fakeHost(), broken);
    await expect(host.listWindows!()).resolves.toMatchObject({ windows: WINDOWS });
  });
});

describe('sightedHosts', () => {
  it('wraps each session once, so the same session is the same host every call', async () => {
    const session = fakeHost();
    const hosts = sightedHosts(() => [session], sight);
    const [first] = hosts();
    const [second] = hosts();
    expect(first).toBe(second);
    await first!.listWindows!();
    expect(rows()).toHaveLength(1);
  });
});

describe('recordSnapshot', () => {
  it('logs a hotkey snapshot by its title and selection size', () => {
    recordSnapshot(sight, { app: { name: 'Code.exe', windowTitle: 'main.ts' }, selection: 'abc' });
    expect(rows()).toMatchObject([
      { kind: 'read_text', app: 'Code.exe', title: 'main.ts', chars: 3 },
    ]);
  });

  it('logs nothing for no snapshot, or one that read nothing', () => {
    recordSnapshot(sight, undefined);
    recordSnapshot(sight, { app: { name: 'Code.exe', blocked: BLOCK } });
    expect(rows()).toEqual([]);
  });
});
