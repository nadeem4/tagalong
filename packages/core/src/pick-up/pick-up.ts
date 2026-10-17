/**
 * Pick up where you left off. One snapshot of what you were in the middle of, from window
 * titles alone, overwritten every ten minutes while a host is connected. A gap of six hours
 * since the last overwrite is the day ending: the snapshot is ready, and a check-in takes it
 * once (at launch, or on the next tick when you are back); the mind may say a line about it,
 * which comes with the card, or nothing. Then a new one starts. Nothing opens or runs
 * without a click. Contains PickUp, takeSnapshot and readBranch.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  CaptureExclusions,
  PickUpEditor,
  PickUpItem,
  ProjectCandidate,
  WindowEntry,
} from '@tagalong/protocol';
import { findCaptureBlock } from '../perception/exclusions';
import type { WatchClock } from '../watch/watch-manager';
import type { PickUpSnapshot, PickUpStore, SnapshotHandoff, SnapshotProject } from './store';

export const SNAPSHOT_EVERY_MS = 10 * 60_000;
export const BACK_AFTER_MS = 6 * 3_600_000;
/** The first look after boot: late enough for the launch check-in to take a ready snapshot first. */
export const FIRST_LOOK_MS = 60_000;
const MAX_ITEMS = 3;

/** Editors by process name, lower case and without `.exe`. VS Code and Cursor reopen by link. */
const EDITORS: Record<string, PickUpEditor> = {
  code: 'vscode',
  'code - insiders': 'vscode',
  cursor: 'cursor',
  devenv: 'other',
  idea64: 'other',
  pycharm64: 'other',
  webstorm64: 'other',
  rider64: 'other',
  goland64: 'other',
  clion64: 'other',
  phpstorm64: 'other',
  rubymine64: 'other',
};

function editorOf(processName: string): PickUpEditor | undefined {
  return EDITORS[processName.toLowerCase().replace(/\.exe$/, '')];
}

/** The file in front, from an editor title such as `● engine.ts - ai_pet - Visual Studio Code`. */
function fileOf(title: string, project: string): string | undefined {
  return title
    .split(/\s[-–—]\s/)
    .map((part) => part.replace(/^[●*•]\s*/, '').trim())
    .find((part) => part !== project && /^[^\\/\s]+\.[A-Za-z0-9]{1,8}$/.test(part));
}

/** The branch a project is on, from `.git/HEAD`, following a worktree's `gitdir:` file. */
export function readBranch(project: string): string | undefined {
  try {
    const dotGit = join(project, '.git');
    let gitDir = dotGit;
    if (statSync(dotGit).isFile()) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1];
      if (pointer === undefined) return undefined;
      gitDir = resolve(project, pointer.trim());
    }
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    // A detached HEAD names a commit, not a branch: no branch is said.
    return /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1];
  } catch {
    return undefined;
  }
}

/** What is open now: editor projects and unsent briefs, three of each at most. */
export function takeSnapshot(input: {
  windows: readonly WindowEntry[];
  exclusions: CaptureExclusions;
  suggest: (title: string) => ProjectCandidate[];
  readBranch: (path: string) => string | undefined;
  pending: () => { expertId: string; expertName: string; ask: string }[];
}): Pick<PickUpSnapshot, 'projects' | 'handoffs'> {
  const front = [...input.windows].sort(
    (a, b) => Number(b.state === 'foreground') - Number(a.state === 'foreground'),
  );
  const projects: SnapshotProject[] = [];
  for (const window of front) {
    if (projects.length >= MAX_ITEMS) break;
    const editor = editorOf(window.processName);
    if (editor === undefined) continue;
    // A blind spot or an exclusion is never stored, its title included.
    if (window.blocked !== undefined || findCaptureBlock(window, input.exclusions) !== null) {
      continue;
    }
    const named = input.suggest(window.title).find((candidate) => candidate.reason === 'screen');
    if (named === undefined || projects.some((project) => project.path === named.path)) continue;
    const branch = input.readBranch(named.path);
    const file = fileOf(window.title, named.name);
    projects.push({
      name: named.name,
      path: named.path,
      editor,
      ...(branch === undefined ? {} : { branch }),
      ...(file === undefined ? {} : { file }),
    });
  }
  const handoffs = input
    .pending()
    .slice(0, MAX_ITEMS)
    .map((proposal) => ({ ...proposal, state: 'unsent' as const }));
  return { projects, handoffs };
}

/** A ready pick-up: what the card lists, and when the snapshot was last overwritten. */
export interface PickUpReady {
  items: PickUpItem[];
  takenAt: number;
}

export interface PickUpOptions {
  store: PickUpStore;
  clock: WatchClock;
  /** `settings.pickUp`: off means no snapshot at all. */
  enabled: () => boolean;
  /** What is open, titles only; null when no host that can list windows is connected. */
  windows: () => Promise<readonly WindowEntry[] | null>;
  exclusions: () => CaptureExclusions;
  suggest: (title: string) => ProjectCandidate[];
  readBranch: (path: string) => string | undefined;
  /** Briefs waiting for Send: who and the ask only. */
  pending: () => { expertId: string; expertName: string; ask: string }[];
  /** Hand-offs that ended stopped or failed (interrupted included) since an ISO time. */
  stoppedSince: (since: string) => SnapshotHandoff[];
  /** Brief again: the saved ask goes to the hand-off card. Nothing starts. */
  propose: (handoff: { expertId: string; ask: string }) => void;
  /** A snapshot is ready: the check-in takes it when its gate is open, else the next tick asks again. */
  onReady: () => void;
  log?: (message: string) => void;
}

/** The snapshot's tick, the back check, and the one pick-up a check-in takes. */
export class PickUp {
  readonly #options: PickUpOptions;
  /** The hand-offs of the pick-up last offered, by item id, for Brief again. */
  #offered: Map<string, SnapshotHandoff> | null = null;
  #timer: unknown = null;

  constructor(options: PickUpOptions) {
    this.#options = options;
  }

  start(): void {
    const next = (ms: number) => {
      this.#timer = this.#options.clock.setTimeout(() => {
        void this.tick().finally(() => {
          if (this.#timer !== null) next(SNAPSHOT_EVERY_MS);
        });
      }, ms);
    };
    next(FIRST_LOOK_MS);
  }

  stop(): void {
    if (this.#timer !== null) this.#options.clock.clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Says a ready snapshot is there, leaving it in place; otherwise overwrites it with what is open now. */
  async tick(): Promise<void> {
    const options = this.#options;
    if (!options.enabled()) return;
    let windows: readonly WindowEntry[] | null;
    try {
      windows = await options.windows();
    } catch (error) {
      options.log?.(`pick-up could not list windows: ${(error as Error).message}`);
      return;
    }
    // No host connected: nobody to offer it to, so a ready snapshot is kept, not spent.
    if (windows === null || !options.enabled()) return;
    if (this.#ready() !== null) {
      options.onReady();
      return;
    }
    const now = options.clock.now();
    options.store.save({
      startedAt: options.store.get()?.startedAt ?? now,
      takenAt: now,
      ...takeSnapshot({
        windows,
        exclusions: options.exclusions(),
        suggest: options.suggest,
        readBranch: options.readBranch,
        pending: options.pending,
      }),
    });
  }

  /** Takes the pick-up: returns it once and starts a new snapshot. */
  take(): PickUpReady | null {
    const ready = this.#ready();
    if (ready === null) return null;
    const now = this.#options.clock.now();
    this.#options.store.save({ startedAt: now, takenAt: now, projects: [], handoffs: [] });
    this.#offered = ready.handoffs;
    return ready.pickUp;
  }

  /** Brief again on one item of the pick-up last offered. False when there is no such hand-off. */
  rebrief(itemId: string): boolean {
    const handoff = this.#offered?.get(itemId);
    if (handoff === undefined) return false;
    this.#options.propose({ expertId: handoff.expertId, ask: handoff.ask });
    return true;
  }

  /** Not now: the offer is dropped. */
  dismiss(): boolean {
    const had = this.#offered !== null;
    this.#offered = null;
    return had;
  }

  /** Switched off: the snapshot is deleted. */
  clear(): void {
    this.#options.store.clear();
    this.#offered = null;
  }

  #ready(): { pickUp: PickUpReady; handoffs: Map<string, SnapshotHandoff> } | null {
    const options = this.#options;
    if (!options.enabled()) return null;
    const snapshot = options.store.get();
    const now = options.clock.now();
    if (snapshot === null || now - snapshot.takenAt < BACK_AFTER_MS) return null;
    const handoffs = new Map<string, SnapshotHandoff>();
    const seen = new Set<string>();
    const since = new Date(snapshot.startedAt).toISOString();
    for (const handoff of [...snapshot.handoffs, ...options.stoppedSince(since)]) {
      const key = `${handoff.expertId}\n${handoff.ask}`;
      if (seen.has(key) || handoffs.size >= MAX_ITEMS) continue;
      seen.add(key);
      handoffs.set(randomUUID(), handoff);
    }
    const items: PickUpItem[] = [
      ...snapshot.projects
        .slice(0, MAX_ITEMS)
        .map((project) => ({ id: randomUUID(), kind: 'project' as const, ...project })),
      ...[...handoffs].map(([id, { expertName, ask, state }]) => ({
        id,
        kind: 'handoff' as const,
        expertName,
        ask,
        state,
      })),
    ];
    if (items.length === 0) return null;
    return { pickUp: { items, takenAt: snapshot.takenAt }, handoffs };
  }
}
