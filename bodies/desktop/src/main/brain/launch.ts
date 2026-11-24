/**
 * Starts the brain for the desktop: unless it is paired with a remote brain, when the brain
 * address is local and nothing answers there, runs `uv run brain` from the brain/ folder,
 * detached (hidden on Windows), its output going to <TAGALONG_HOME>/brain.log. Packaged, it runs `uv sync` first (the first-run install) and
 * reports installing/failed. Quitting the app never stops the brain; only a restart for a
 * version update does (`stopBrain`, never for a brain the person started themselves).
 * A start failure only logs: the client retries.
 */
import { execFile, spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { NodeChild } from '../node/runner';

const DEFAULT_ADDR = '127.0.0.1:47321';

/** The address the brain is dialed at when no remote brain is paired. */
export const localBrainAddr = (env: NodeJS.ProcessEnv): string =>
  env.TAGALONG_BRAIN_ADDR ?? DEFAULT_ADDR;

export type SetupState = 'idle' | 'installing' | 'failed';

export interface LaunchOptions {
  env: NodeJS.ProcessEnv;
  /** The brain/ folder: the repo's in dev, resources\brain when packaged. */
  brainDir: string;
  /** The uv to run: 'uv' from PATH in dev, resources\uv\uv.exe when packaged. */
  uv: string;
  /** True when packaged: install the brain's dependencies (`uv sync`) before starting it. */
  sync: boolean;
  /** Windows starts the brain hidden instead of detached (see the spawn below). */
  platform: NodeJS.Platform;
  /** First-run progress for Home: installing while the sync runs, failed if it did not finish. */
  onSetup: (state: SetupState) => void;
  /** True while the desktop is starting the brain (before sync or spawn), false when that start ends. */
  onStarting: (on: boolean) => void;
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
  /** True when the desktop is paired with a brain on another machine: there is nothing to start. */
  remote: () => boolean;
}

/** The brain's own data folder rule (config.py): TAGALONG_HOME, else ~/.tagalong. */
export function dataDir(env: NodeJS.ProcessEnv, home: string): string {
  return env.TAGALONG_HOME || join(home, '.tagalong');
}

/** The token the brain makes for bodies on this machine; null until the brain has written it. */
export function readLocalToken(env: NodeJS.ProcessEnv, home: string): string | null {
  try {
    return readFileSync(join(dataDir(env, home), 'local-token'), 'utf8').trim();
  } catch {
    return null;
  }
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

/** True when this run must start no brain and no node (the e2e suites and a remote-only setup). */
export function startsNoProcesses(env: NodeJS.ProcessEnv): boolean {
  return env.TAGALONG_START_BRAIN === '0';
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
  onStarting?: (on: boolean) => void;
  env?: NodeJS.ProcessEnv;
  remote: () => boolean;
}

/** The env the brain runs with: the packaged one carries uv's folders and the build id. */
function brainEnv({ packaged, appVersion, env = process.env }: RealLaunch): NodeJS.ProcessEnv {
  return packaged ? packagedEnv(env, homedir(), appVersion) : env;
}

function uvOptions(real: RealLaunch): Pick<LaunchOptions, 'env' | 'brainDir' | 'uv' | 'spawn'> {
  return {
    env: brainEnv(real),
    brainDir: real.brainDir,
    uv: real.packaged?.uv ?? 'uv',
    spawn: nodeSpawn,
  };
}

export function realRunTagalong(
  real: RealLaunch,
  args: string[],
): Promise<{ code: number; out: string }> {
  return runTagalong(uvOptions(real), args);
}

/** `tagalong node run` as a child the desktop owns; ending it ends uv's python child too. */
export function realSpawnNode(real: RealLaunch, nodeEnv: NodeJS.ProcessEnv): NodeChild {
  const { env, brainDir, uv } = uvOptions(real);
  const child = nodeSpawn(uv, ['run', '--no-sync', 'tagalong', 'node', 'run'], {
    cwd: brainDir,
    env: { ...env, ...nodeEnv },
    stdio: 'ignore',
    windowsHide: true,
  });
  return {
    kill: () => {
      if (process.platform === 'win32' && child.pid !== undefined) {
        nodeSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else child.kill();
    },
    onExit: (listener) => {
      child.once('exit', listener);
      child.once('error', listener);
    },
  };
}

export function realStop(real: RealLaunch): Promise<boolean> {
  return stopBrain(uvOptions(real));
}

export function realLaunch(real: RealLaunch): Promise<void> {
  const { packaged, onSetup = () => undefined, onStarting = () => undefined } = real;
  const uv = uvOptions(real);
  return launchBrain({
    ...uv,
    sync: packaged !== undefined,
    platform: process.platform,
    onSetup,
    onStarting,
    logPath: brainLogPath(uv.env, homedir()),
    openLog: (path) => {
      mkdirSync(dirname(path), { recursive: true });
      return openSync(path, 'a');
    },
    closeLog: closeSync,
    probe: probeAddr,
    exists: existsSync,
    log: { warn: (line) => console.warn(line) },
    remote: real.remote,
  });
}

/**
 * Ends the brain the desktop started (`tagalong stop`, by its pid file) for a restart. True when
 * the command exited cleanly. Callers check who started the brain first: never a person's.
 */
export function stopBrain(
  options: Pick<LaunchOptions, 'env' | 'brainDir' | 'uv' | 'spawn'>,
): Promise<boolean> {
  return runTagalong(options, ['stop']).then(({ code }) => code === 0);
}

/**
 * One `tagalong` command through uv; its exit code and output. Never syncs: a sync rewrites
 * .venv/Scripts/brain.exe, which the running brain holds open on Windows, so uv would fail before
 * `tagalong stop` runs. The relaunch syncs instead.
 */
export function runTagalong(
  options: Pick<LaunchOptions, 'env' | 'brainDir' | 'uv' | 'spawn'>,
  args: string[],
): Promise<{ code: number; out: string }> {
  const { env, brainDir, uv, spawn } = options;
  return new Promise((resolve) => {
    const child = spawn(uv, ['run', '--no-sync', 'tagalong', ...args], {
      cwd: brainDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    const collect = (chunk: Buffer): void => void (out += chunk.toString());
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.once('error', (error) => resolve({ code: 1, out: error.message }));
    child.once('exit', (code) => resolve({ code: code ?? 1, out }));
  });
}

/** `tailscale ip -4`; rejects when there is no tailscale command, so a missing install reads apart from a signed-out one. */
export function runTailscale(
  exec: typeof execFile = execFile,
): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    exec('tailscale', ['ip', '-4'], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT') reject(error);
      else resolve({ code: error === null ? 0 : 1, out: stdout });
    });
  });
}

export async function launchBrain(options: LaunchOptions): Promise<void> {
  const { env, brainDir, uv, sync, platform, onSetup, onStarting, logPath } = options;
  const { openLog, closeLog, probe } = options;
  const { exists, spawn } = options;
  const { log, remote } = options;
  const addr = localBrainAddr(env);
  if (startsNoProcesses(env) || remote() || !isLocal(addr)) return;
  if (!exists(join(brainDir, 'pyproject.toml'))) return;
  if (await probe(addr)) return;

  onStarting(true);
  if (sync) {
    onSetup('installing');
    if (!(await syncBrain(options))) {
      onSetup('failed');
      onStarting(false);
      return;
    }
    onSetup('idle');
  }

  const fd = openLog(logPath);
  const child = spawn(uv, sync ? ['run', '--frozen', '--no-dev', 'brain'] : ['run', 'brain'], {
    cwd: brainDir,
    // Tells the brain the desktop owns it, so the version check may restart it.
    env: { ...env, TAGALONG_STARTED_BY: 'desktop' },
    // On Windows, detached means no console at all, so uv's console child (the brain) gets a
    // new, visible window. Not detached, windowsHide gives uv a hidden console the brain
    // shares; it still outlives the app. Elsewhere detached keeps it out of the app's session.
    detached: platform !== 'win32',
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  closeLog(fd); // the child holds its own copy; ours would leak
  let running = true;
  child.on('error', (error) => {
    running = false;
    onStarting(false);
    log.warn(`could not start the brain (${error.message}); the desktop keeps retrying`);
  });
  child.once('exit', (code) => {
    if (!running) return;
    running = false;
    onStarting(false);
    log.warn(`brain exited with code ${code}; the desktop keeps retrying`);
  });
  // Unreferenced (and detached or hidden): quitting the app leaves the brain running.
  child.unref();
}

type SyncOptions = Pick<
  LaunchOptions,
  'env' | 'brainDir' | 'uv' | 'spawn' | 'openLog' | 'closeLog' | 'logPath' | 'log'
>;

/** `uv sync` with its output in brain.log and no timeout (the first download is slow). True when it finished cleanly. */
export function syncBrain(options: SyncOptions): Promise<boolean> {
  const { env, brainDir, uv, spawn, openLog, closeLog, logPath, log } = options;
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

/**
 * Updates a brain the logon service runs: the service is removed (that ends the brain and frees
 * its files), the app's files are synced, and installing the service again starts the new brain.
 */
export async function restartService(
  run: (args: string[]) => Promise<{ code: number; out: string }>,
  sync: () => Promise<boolean>,
): Promise<boolean> {
  await run(['service', 'remove']);
  const synced = await sync();
  const installed = (await run(['service', 'install'])).code === 0;
  return synced && installed;
}

export function realRestartService(real: RealLaunch): Promise<boolean> {
  const uv = uvOptions(real);
  return restartService(
    (args) => runTagalong(uv, args),
    () =>
      real.packaged === undefined
        ? Promise.resolve(true)
        : syncBrain({
            ...uv,
            logPath: brainLogPath(uv.env, homedir()),
            openLog: (path) => {
              mkdirSync(dirname(path), { recursive: true });
              return openSync(path, 'a');
            },
            closeLog: closeSync,
            log: { warn: (line) => console.warn(line) },
          }),
  );
}
