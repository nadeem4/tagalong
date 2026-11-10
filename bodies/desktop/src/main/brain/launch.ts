/**
 * Starts the brain for the desktop: when the brain address is local and nothing answers
 * there, runs `uv run brain` from the brain/ folder, detached, its output going to
 * <TAGALONG_HOME>/brain.log. Packaged, it runs `uv sync` first (the first-run install) and
 * reports installing/failed. Quitting the app never stops the brain; only a restart for a
 * version update does (`stopBrain`, never for a brain the person started themselves).
 * A start failure only logs: the client retries.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_ADDR = '127.0.0.1:47321';

export type SetupState = 'idle' | 'installing' | 'failed';

export interface LaunchOptions {
  env: NodeJS.ProcessEnv;
  /** The brain/ folder: the repo's in dev, resources\brain when packaged. */
  brainDir: string;
  /** The uv to run: 'uv' from PATH in dev, resources\uv\uv.exe when packaged. */
  uv: string;
  /** True when packaged: install the brain's dependencies (`uv sync`) before starting it. */
  sync: boolean;
  /** First-run progress for Home: installing while the sync runs, failed if it did not finish. */
  onSetup: (state: SetupState) => void;
  /** Where the detached brain's output goes. */
  logPath: string;
  /** Opens the log for append and returns its fd. */
  openLog: (path: string) => number;
  /** Closes that fd in this process once the child has its own copy. */
  closeLog: (fd: number) => void;
  /** True when something accepts a connection at host:port. */
  probe: (addr: string) => Promise<boolean>;
  exists: (path: string) => boolean;
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  log: { warn: (line: string) => void };
}

/** The brain's own data folder rule (config.py): TAGALONG_HOME, else ~/.tagalong. */
function dataDir(env: NodeJS.ProcessEnv, home: string): string {
  return env.TAGALONG_HOME || join(home, '.tagalong');
}

export function brainLogPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(dataDir(env, home), 'brain.log');
}

/** Packaged only: keeps uv's venv, Python and cache under the data folder, away from the installer's read-only folder. */
export function packagedEnv(
  env: NodeJS.ProcessEnv,
  home: string,
  appVersion: string,
): NodeJS.ProcessEnv {
  const data = dataDir(env, home);
  return {
    ...env,
    TAGALONG_BUILD: appVersion, // the brain's build id; hello carries it for the version check
    UV_PROJECT_ENVIRONMENT: join(data, 'runtime', 'venv'),
    UV_PYTHON_INSTALL_DIR: join(data, 'runtime', 'python'),
    UV_CACHE_DIR: join(data, 'cache', 'uv'),
    UV_PYTHON_PREFERENCE: 'only-managed',
  };
}

function hostOf(addr: string): string {
  return addr.slice(0, addr.lastIndexOf(':')).replace(/^\[|\]$/g, '');
}

export function isLocal(addr: string): boolean {
  return ['127.0.0.1', 'localhost', '::1'].includes(hostOf(addr));
}

/** A refused connection means nothing listens; a timeout counts as "answers", so we never spawn on doubt. */
export function probeAddr(addr: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({
      host: hostOf(addr),
      port: Number(addr.slice(addr.lastIndexOf(':') + 1)),
    });
    socket.setTimeout(1000, () => done(true));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    function done(answers: boolean): void {
      socket.destroy();
      resolve(answers);
    }
  });
}

export interface RealLaunch {
  brainDir: string;
  /** Packaged: uv.exe at this path and a first-run sync. Dev: `uv` from PATH, no sync. */
  packaged?: { uv: string } | undefined;
  /** The app's version; packaged, it is the brain's build id. */
  appVersion: string;
  onSetup?: (state: SetupState) => void;
  env?: NodeJS.ProcessEnv;
}

export function realLaunch({
  brainDir,
  packaged,
  appVersion,
  onSetup = () => undefined,
  env: base = process.env,
}: RealLaunch): Promise<void> {
  const env = packaged ? packagedEnv(base, homedir(), appVersion) : base;
  return launchBrain({
    env,
    brainDir,
    uv: packaged?.uv ?? 'uv',
    sync: packaged !== undefined,
    onSetup,
    logPath: brainLogPath(env, homedir()),
    openLog: (path) => {
      mkdirSync(dirname(path), { recursive: true });
      return openSync(path, 'a');
    },
    closeLog: closeSync,
    probe: probeAddr,
    exists: existsSync,
    spawn: nodeSpawn,
    log: { warn: (line) => console.warn(line) },
  });
}

/**
 * Ends the brain the desktop started (`tagalong stop`, by its pid file) for a restart. True when
 * the command exited cleanly. Callers check who started the brain first: never a person's.
 */
export function stopBrain(
  options: Pick<LaunchOptions, 'env' | 'brainDir' | 'uv' | 'sync' | 'spawn'>,
): Promise<boolean> {
  const { env, brainDir, uv, sync, spawn } = options;
  const args = sync ? ['run', '--frozen', '--no-dev', 'tagalong', 'stop'] : ['run', 'tagalong', 'stop'];
  return new Promise((resolve) => {
    const child = spawn(uv, args, { cwd: brainDir, env, stdio: 'ignore', windowsHide: true });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

export async function launchBrain(options: LaunchOptions): Promise<void> {
  const { env, brainDir, uv, sync, onSetup, logPath, openLog, closeLog, probe, exists, spawn } =
    options;
  const { log } = options;
  const addr = env.TAGALONG_BRAIN_ADDR ?? DEFAULT_ADDR;
  if (env.TAGALONG_START_BRAIN === '0' || !isLocal(addr)) return;
  if (!exists(join(brainDir, 'pyproject.toml'))) return;
  if (await probe(addr)) return;

  if (sync) {
    onSetup('installing');
    if (!(await runSync())) {
      onSetup('failed');
      return;
    }
    onSetup('idle');
  }

  const fd = openLog(logPath);
  const child = spawn(uv, sync ? ['run', '--frozen', '--no-dev', 'brain'] : ['run', 'brain'], {
    cwd: brainDir,
    // Tells the brain the desktop owns it, so the version check may restart it.
    env: { ...env, TAGALONG_STARTED_BY: 'desktop' },
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  closeLog(fd); // the child holds its own copy; ours would leak
  let running = true;
  child.on('error', (error) => {
    running = false;
    log.warn(`could not start the brain (${error.message}); the desktop keeps retrying`);
  });
  child.once('exit', (code) => {
    if (!running) return;
    running = false;
    log.warn(`brain exited with code ${code}; the desktop keeps retrying`);
  });
  // Detached and unreferenced: quitting the app leaves the brain running.
  child.unref();

  /** `uv sync` with its output in brain.log and no timeout (the first download is slow). True when it finished cleanly. */
  function runSync(): Promise<boolean> {
    const syncFd = openLog(logPath);
    return new Promise((resolve) => {
      const child = spawn(uv, ['sync', '--frozen', '--no-dev'], {
        cwd: brainDir,
        env,
        stdio: ['ignore', syncFd, syncFd],
        windowsHide: true,
      });
      closeLog(syncFd);
      let settled = false;
      const done = (ok: boolean, why: string): void => {
        if (settled) return;
        settled = true;
        if (!ok) log.warn(`could not install the brain (${why}); Home offers Retry`);
        resolve(ok);
      };
      child.once('error', (error) => done(false, error.message));
      child.once('exit', (code) => done(code === 0, `uv sync exited with code ${code}`));
    });
  }
}
