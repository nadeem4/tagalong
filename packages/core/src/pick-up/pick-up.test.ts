import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PickUpReadyParams, ProjectCandidate, WindowEntry } from '@tagalong/protocol';
import { migrate } from '../memory/db';
import { FakeClock } from '../watch/fake-clock';
import {
  BACK_AFTER_MS,
  PickUp,
  SNAPSHOT_EVERY_MS,
  describePickUp,
  readBranch,
  takeSnapshot,
  type PickUpOptions,
} from './pick-up';
import { PickUpStore } from './store';

const AI_PET = 'C:\\projects\\ai_pet';
const NO_EXCLUSIONS = { processNames: [], titlePatterns: [] };

function win(title: string, processName = 'Code.exe', extra: Partial<WindowEntry> = {}) {
  return {
    id: title,
    processName,
    title,
    state: 'background',
    browser: false,
    ...extra,
  } satisfies WindowEntry;
}

/** A finder that knows one project, named in a title as editors write it. */
function suggest(title: string | undefined): ProjectCandidate[] {
  const remembered: ProjectCandidate = { name: 'old', path: 'C:\\old', reason: 'remembered' };
  if (title?.includes('ai_pet') === true) {
    return [{ name: 'ai_pet', path: AI_PET, reason: 'screen' }, remembered];
  }
  return [remembered];
}

describe('takeSnapshot', () => {
  const base = {
    exclusions: NO_EXCLUSIONS,
    suggest,
    readBranch: () => 'feat/scout-watch-tools',
    pending: () => [],
  };

  it('turns an editor title into its project, branch and file name', () => {
    const snap = takeSnapshot({
      ...base,
      windows: [win('● engine.ts - ai_pet - Visual Studio Code')],
    });
    expect(snap.projects).toEqual([
      {
        name: 'ai_pet',
        path: AI_PET,
        editor: 'vscode',
        branch: 'feat/scout-watch-tools',
        file: 'engine.ts',
      },
    ]);
  });

  it('knows Cursor, and opens other editors as a folder', () => {
    expect(
      takeSnapshot({ ...base, windows: [win('a.ts - ai_pet - Cursor', 'Cursor.exe')] }).projects[0]
        ?.editor,
    ).toBe('cursor');
    expect(
      takeSnapshot({ ...base, windows: [win('ai_pet – engine.ts', 'idea64.exe')] }).projects[0],
    ).toMatchObject({ editor: 'other', file: 'engine.ts' });
  });

  it('ignores windows that are not editors, and projects only remembered', () => {
    const snap = takeSnapshot({
      ...base,
      windows: [win('ai_pet - Google Chrome', 'chrome.exe'), win('notes.txt - x - VS', 'Code.exe')],
    });
    expect(snap.projects).toEqual([]);
  });

  it('never stores a blocked or excluded window, title included', () => {
    const snap = takeSnapshot({
      ...base,
      exclusions: { processNames: [], titlePatterns: ['*secret*'] },
      windows: [
        win('secret.ts - ai_pet - Visual Studio Code'),
        win('engine.ts - ai_pet - Visual Studio Code', 'Code.exe', {
          blocked: { rule: 'processName', entry: 'Code.exe' },
        }),
        win('.env - ai_pet - Visual Studio Code'),
      ],
    });
    expect(snap.projects).toEqual([]);
    expect(JSON.stringify(snap)).not.toContain('secret');
  });

  it('keeps at most three projects and three hand-offs, the one in front first', () => {
    const many = (n: number) => `f.ts - p${n} - Visual Studio Code`;
    const snap = takeSnapshot({
      ...base,
      suggest: (title) => {
        const name = /- (p\d) -/.exec(title ?? '')?.[1];
        return name === undefined ? [] : [{ name, path: `C:\\${name}`, reason: 'screen' }];
      },
      windows: [
        win(many(1)),
        win(many(2)),
        win(many(3)),
        win(many(4), 'Code.exe', { state: 'foreground' }),
        win(many(1)),
      ],
      pending: () =>
        [1, 2, 3, 4].map((n) => ({ expertId: 'cc', expertName: 'Claude Code', ask: `ask ${n}` })),
    });
    expect(snap.projects.map((p) => p.name)).toEqual(['p4', 'p1', 'p2']);
    expect(snap.handoffs).toHaveLength(3);
    expect(snap.handoffs[0]).toEqual({
      expertId: 'cc',
      expertName: 'Claude Code',
      ask: 'ask 1',
      state: 'unsent',
    });
  });
});

describe('readBranch', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagalong-branch-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the branch from .git/HEAD', () => {
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/feat/pick-up\n');
    expect(readBranch(dir)).toBe('feat/pick-up');
  });

  it('names no branch for a detached HEAD', () => {
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'HEAD'), '9daca89f0e1d2c3b4a5968778695a4b3c2d1e0f9\n');
    expect(readBranch(dir)).toBeUndefined();
  });

  it('follows a worktree’s gitdir file, relative or absolute', () => {
    const real = join(dir, 'main', '.git', 'worktrees', 'wt');
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, 'HEAD'), 'ref: refs/heads/worktree-branch\n');
    const wt = join(dir, 'wt');
    mkdirSync(wt);
    writeFileSync(join(wt, '.git'), `gitdir: ${real}\n`);
    expect(readBranch(wt)).toBe('worktree-branch');
    writeFileSync(join(wt, '.git'), 'gitdir: ../main/.git/worktrees/wt\n');
    expect(readBranch(wt)).toBe('worktree-branch');
  });

  it('names no branch outside a repository', () => {
    expect(readBranch(dir)).toBeUndefined();
    expect(readBranch(join(dir, 'missing'))).toBeUndefined();
  });
});

describe('describePickUp', () => {
  const now = new Date(2026, 9, 15, 9).getTime();
  const yesterday = new Date(2026, 9, 14, 18).getTime();
  const project = {
    id: 'p1',
    kind: 'project',
    name: 'ai_pet',
    path: AI_PET,
    editor: 'vscode',
    branch: 'feat/scout-watch-tools',
    file: 'engine.ts',
  } as const;
  const handoff = {
    id: 'h1',
    kind: 'handoff',
    expertName: 'Claude Code',
    ask: 'fix the e2e tests',
    state: 'stopped',
  } as const;

  it('says the project, the branch, the file and the hand-off left halfway', () => {
    expect(describePickUp({ items: [project, handoff], takenAt: yesterday, now })).toBe(
      'Yesterday you were in ai_pet on feat/scout-watch-tools, with engine.ts open, and Claude Code’s “fix the e2e tests” stopped halfway.',
    );
  });

  it('says one item plainly', () => {
    const { branch: _b, file: _f, ...bare } = project;
    expect(describePickUp({ items: [bare], takenAt: yesterday, now })).toBe(
      'Yesterday you were in ai_pet.',
    );
    expect(
      describePickUp({
        items: [{ ...handoff, state: 'unsent' }],
        takenAt: now - 7 * 3_600_000,
        now,
      }),
    ).toBe('Earlier, Claude Code’s “fix the e2e tests” was never sent.');
  });

  it('counts the rest when there are many', () => {
    const items = [
      project,
      { ...project, id: 'p2', name: 'web' },
      { ...project, id: 'p3', name: 'docs' },
      handoff,
      { ...handoff, id: 'h2', state: 'error' as const },
    ];
    expect(describePickUp({ items, takenAt: now - 3 * 86_400_000, now })).toBe(
      'Last time you were in ai_pet on feat/scout-watch-tools, with engine.ts open, and 2 more projects, and Claude Code’s “fix the e2e tests” stopped halfway, and 1 more hand-off.',
    );
  });

  it('says only hello when there is nothing', () => {
    expect(describePickUp({ items: [], takenAt: yesterday, now })).toBe('Welcome back.');
  });
});

describe('PickUp', () => {
  let db: Database.Database;
  let store: PickUpStore;
  let clock: FakeClock;
  let emitted: PickUpReadyParams[];
  let windows: WindowEntry[] | null;
  let enabled: boolean;
  let stopped: { expertId: string; expertName: string; ask: string; state: 'stopped' | 'error' }[];
  let proposed: { expertId: string; ask: string }[];

  beforeEach(() => {
    db = new Database(':memory:');
    migrate(db);
    store = new PickUpStore(db);
    clock = new FakeClock(Date.UTC(2026, 9, 14, 9));
    emitted = [];
    windows = [win('engine.ts - ai_pet - Visual Studio Code', 'Code.exe', { state: 'foreground' })];
    enabled = true;
    stopped = [];
    proposed = [];
  });
  afterEach(() => db.close());

  function pickUp(over: Partial<PickUpOptions> = {}): PickUp {
    return new PickUp({
      store,
      clock,
      enabled: () => enabled,
      windows: () => Promise.resolve(windows),
      exclusions: () => NO_EXCLUSIONS,
      suggest,
      readBranch: () => 'main',
      pending: () => [],
      stoppedSince: () => stopped,
      propose: (h) => proposed.push(h),
      emit: (params) => emitted.push(params),
      ...over,
    });
  }

  it('snapshots every ten minutes while a host is connected', async () => {
    const p = pickUp();
    p.start();
    await clock.advance(SNAPSHOT_EVERY_MS);
    expect(store.get()?.projects[0]?.name).toBe('ai_pet');
    const first = store.get()?.takenAt;
    windows = null;
    await clock.advance(SNAPSHOT_EVERY_MS);
    expect(store.get()?.takenAt).toBe(first);
    p.stop();
  });

  it('offers nothing when the gap is under six hours', async () => {
    const p = pickUp();
    await p.tick();
    await clock.sleep(BACK_AFTER_MS - 60_000);
    await p.tick();
    expect(emitted).toEqual([]);
    expect(p.ready()).toBeNull();
  });

  it('fires once after six hours away, then starts a new snapshot', async () => {
    const p = pickUp();
    await p.tick();
    windows = [];
    await clock.sleep(BACK_AFTER_MS);
    await p.tick();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.items[0]).toMatchObject({ kind: 'project', name: 'ai_pet', branch: 'main' });
    expect(emitted[0]?.text).toContain('ai_pet');
    await clock.sleep(BACK_AFTER_MS);
    await p.tick();
    expect(emitted).toHaveLength(1);
  });

  it('keeps a ready snapshot while no host is connected, and offers it once one is', async () => {
    const p = pickUp();
    await p.tick();
    await clock.sleep(BACK_AFTER_MS);
    windows = null;
    await p.tick();
    // Nobody to show it to: it is not spent.
    expect(emitted).toEqual([]);
    expect(p.ready()).not.toBeNull();
    windows = [];
    await p.tick();
    expect(emitted).toHaveLength(1);
  });

  it('never fires an empty snapshot', async () => {
    windows = [];
    const p = pickUp();
    await p.tick();
    await clock.sleep(BACK_AFTER_MS * 2);
    await p.tick();
    expect(emitted).toEqual([]);
  });

  it('adds hand-offs that stopped since the snapshot began, at the time it is offered', async () => {
    windows = [];
    const since: string[] = [];
    const p = pickUp({
      stoppedSince: (at) => {
        since.push(at);
        return stopped;
      },
    });
    await p.tick();
    stopped = [
      { expertId: 'cc', expertName: 'Claude Code', ask: 'Fix the tests', state: 'stopped' },
    ];
    await clock.sleep(BACK_AFTER_MS);
    const ready = p.take();
    expect(ready?.items).toEqual([
      expect.objectContaining({ kind: 'handoff', ask: 'Fix the tests', state: 'stopped' }),
    ]);
    expect(since.at(-1)).toBe(new Date(Date.UTC(2026, 9, 14, 9)).toISOString());
  });

  it('is taken once: a launch line that says it leaves nothing for the next tick', async () => {
    const p = pickUp();
    await p.tick();
    await clock.sleep(BACK_AFTER_MS);
    expect(p.ready()).not.toBeNull();
    expect(p.take()).not.toBeNull();
    expect(p.take()).toBeNull();
    await p.tick();
    expect(emitted).toEqual([]);
  });

  it('briefs again by proposing the saved ask, and never starts anything', async () => {
    windows = [];
    const p = pickUp({
      pending: () => [{ expertId: 'cc', expertName: 'Claude Code', ask: 'Fix the tests' }],
    });
    await p.tick();
    await clock.sleep(BACK_AFTER_MS);
    const ready = p.take();
    const item = ready?.items[0];
    expect(item?.kind).toBe('handoff');
    expect(p.rebrief(item?.id ?? '')).toBe(true);
    expect(proposed).toEqual([{ expertId: 'cc', ask: 'Fix the tests' }]);
    expect(p.rebrief('nope')).toBe(false);
  });

  it('refuses to brief a project item, and drops the offer on Not now', async () => {
    const p = pickUp();
    await p.tick();
    await clock.sleep(BACK_AFTER_MS);
    const ready = p.take();
    expect(p.rebrief(ready?.items[0]?.id ?? '')).toBe(false);
    expect(p.dismiss()).toBe(true);
    expect(p.dismiss()).toBe(false);
    expect(proposed).toEqual([]);
  });

  it('keeps no snapshot while switched off, and switching off deletes it', async () => {
    const p = pickUp();
    await p.tick();
    expect(store.get()).not.toBeNull();
    p.clear();
    expect(store.get()).toBeNull();
    enabled = false;
    await p.tick();
    expect(store.get()).toBeNull();
    await clock.sleep(BACK_AFTER_MS);
    expect(p.take()).toBeNull();
  });

  it('survives a host that fails to list windows', async () => {
    const log = vi.fn();
    const p = pickUp({ windows: () => Promise.reject(new Error('gone')), log });
    await p.tick();
    expect(store.get()).toBeNull();
    expect(log).toHaveBeenCalled();
  });
});
