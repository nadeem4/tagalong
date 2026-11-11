/**
 * Scout's brain card and the version check around it. `createBrainStatus` reads the brain's
 * `brain_status` tool (or what the desktop knows while offline), decides on every hello whether
 * the brain is older than the app (version-check.ts) and restarts it quietly, or leaves the
 * banner for Home; `registerBrainStatusIpc` hands the card's calls to Home. A brain the person
 * started is never stopped from here.
 */
import type { BrainCard } from '@tagalong/ui';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import { decideUpdate } from '../brain/version-check';
import type { BuildId } from '../brain/version-check';
import type { IpcHandle } from './handle';

const Wire = z.object({
  version: z.string(),
  build: z.string(),
  pid: z.number(),
  started_at: z.string(),
  started_by: z.enum(['desktop', 'person']),
  data_dir: z.string(),
  log_path: z.string(),
  places: z.array(z.object({ id: z.string(), kind: z.string(), name: z.string() })),
  work_running: z.boolean(),
});
type Facts = z.infer<typeof Wire>;

/** What hello says of the brain; an old brain says nothing. */
type HelloBuild = { version?: string | undefined; build?: string | undefined };

export interface BrainStatusDeps {
  brain: BrainCall & { addr: string; link: string };
  /** The app's own version and build, to compare with the brain's. */
  ours: BuildId;
  /** Where the brain keeps things when it cannot be asked (the same rule as launch.ts). */
  fallback: { dataDir: string; logPath: string };
  /** Ends the brain (`tagalong stop`); true when it exited cleanly. */
  stop: () => Promise<boolean>;
  /** Starts it again (the setup's retry). */
  relaunch: () => Promise<void>;
  openPath: (path: string) => Promise<void>;
  copy: (text: string) => void;
  log: (line: string) => void;
  /** Home should read the card again. */
  onChange: () => void;
}

export interface BrainStatusControl {
  card(): Promise<BrainCard>;
  restart(): Promise<void>;
  restartAfterWork(): Promise<void>;
  /** The brain said hello: compare builds, then restart quietly or leave the banner on. */
  check(theirs: HelloBuild): Promise<void>;
  /** A job changed: a restart waiting for work to finish may go now. */
  jobsChanged(): Promise<void>;
  openFolder(): Promise<void>;
  openLog(): Promise<void>;
  copyDetails(): Promise<void>;
}

export function createBrainStatus(deps: BrainStatusDeps): BrainStatusControl {
  const { brain, ours, fallback } = deps;
  let update: BrainCard['update'] = 'none';
  let restartedThisRun = false;
  let waitingForWork = false;
  let lastHello: HelloBuild = {};

  /** The brain's own facts; null offline or from an old brain with no `brain_status`. */
  async function facts(): Promise<Facts | null> {
    if (brain.link !== 'online') return null;
    try {
      return Wire.parse(await callJson(brain, 'brain_status'));
    } catch {
      return null;
    }
  }

  async function card(): Promise<BrainCard> {
    const f = await facts();
    return {
      status: brain.link === 'online' ? 'running' : 'offline',
      update,
      version: f?.version ?? (brain.link === 'online' ? (lastHello.version ?? null) : null),
      build: f?.build ?? (brain.link === 'online' ? (lastHello.build ?? null) : null),
      appVersion: ours.version,
      appBuild: ours.build,
      startedAt: f?.started_at ?? null,
      startedBy: f?.started_by ?? null,
      addr: brain.addr,
      pid: f?.pid ?? null,
      dataDir: f?.data_dir ?? fallback.dataDir,
      logPath: f?.log_path ?? fallback.logPath,
      places: f?.places ?? [],
      workRunning: f?.work_running ?? false,
    };
  }

  async function stopAndStart(): Promise<boolean> {
    if (!(await deps.stop())) return false;
    await deps.relaunch();
    return true;
  }

  async function restart(): Promise<void> {
    if ((await facts())?.started_by === 'person') {
      throw new Error('You started the brain yourself, so restart it in your terminal.');
    }
    if (!(await stopAndStart())) throw new Error('Scout could not restart the brain.');
  }

  async function restartAfterWork(): Promise<void> {
    waitingForWork = true;
    await jobsChanged();
  }

  async function jobsChanged(): Promise<void> {
    if (!waitingForWork) return;
    const f = await facts();
    // No facts (an old brain, or the answer failed) means unknown, not idle: keep waiting
    // rather than stop a job that may be running.
    if (f === null || f.work_running) return;
    waitingForWork = false;
    await restart();
  }

  async function check(theirs: HelloBuild): Promise<void> {
    lastHello = theirs;
    const f = await facts();
    const action = decideUpdate(ours, theirs, {
      startedBy: f?.started_by ?? null,
      workRunning: f?.work_running ?? false,
      restartedThisRun,
    });
    if (action === 'restart') {
      restartedThisRun = true;
      deps.log(
        `the brain is older than the app (${theirs.version ?? 'no version'} against ${ours.version}); restarting it once`,
      );
      update = (await stopAndStart()) ? 'none' : 'ready';
    } else {
      update = action === 'current' ? 'none' : action === 'terminal' ? 'terminal' : 'ready';
    }
    deps.onChange();
  }

  async function copyDetails(): Promise<void> {
    const f = await facts();
    const c = await card();
    deps.copy(
      [
        `Version: ${c.version ?? 'unknown'}`,
        `Build: ${f?.build ?? lastHello.build ?? 'unknown'}`,
        `Process ID: ${c.pid ?? 'unknown'}`,
        `Address: ${c.addr}`,
        `Data folder: ${c.dataDir}`,
        `Started by: ${c.startedBy ?? 'unknown'}`,
      ].join('\n'),
    );
  }

  return {
    card,
    restart,
    restartAfterWork,
    check,
    jobsChanged,
    openFolder: async () => deps.openPath((await card()).dataDir),
    openLog: async () => deps.openPath((await card()).logPath),
    copyDetails,
  };
}

export function registerBrainStatusIpc(handle: IpcHandle, control: BrainStatusControl): void {
  handle(IPC.brainStatus, () => control.card());
  handle(IPC.brainRestart, () => control.restart());
  handle(IPC.brainRestartAfterWork, () => control.restartAfterWork());
  handle(IPC.brainOpenFolder, () => control.openFolder());
  handle(IPC.brainOpenLog, () => control.openLog());
  handle(IPC.brainCopyDetails, () => control.copyDetails());
}
