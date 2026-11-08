/**
 * Starts the brain for the desktop: when the brain address is local and nothing answers
 * there, runs `uv run brain` from the repo's brain/ folder, detached, its output going to
 * <TAGALONG_HOME>/brain.log. The desktop never stops it (`tagalong stop` does), so the brain
 * outlives the app. A failure only logs: the client retries.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_ADDR = '127.0.0.1:47321';

export interface LaunchOptions {
  env: NodeJS.ProcessEnv;
  /** The repo's brain/ folder; absent in a packaged app, where nothing is spawned. */
  brainDir: string;
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
export function brainLogPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(env.TAGALONG_HOME || join(home, '.tagalong'), 'brain.log');
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

export function realLaunch(brainDir: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return launchBrain({
    env,
    brainDir,
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

export async function launchBrain(options: LaunchOptions): Promise<void> {
  const { env, brainDir, logPath, openLog, closeLog, probe, exists, spawn, log } = options;
  const addr = env.TAGALONG_BRAIN_ADDR ?? DEFAULT_ADDR;
  if (env.TAGALONG_START_BRAIN === '0' || !isLocal(addr)) return;
  if (!exists(join(brainDir, 'pyproject.toml'))) return;
  if (await probe(addr)) return;

  const fd = openLog(logPath);
  const child = spawn('uv', ['run', 'brain'], {
    cwd: brainDir,
    env,
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
}
