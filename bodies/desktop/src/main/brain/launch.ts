/**
 * Starts the brain for the desktop: when the brain address is local and nothing answers
 * there, runs `uv run brain` from the repo's brain/ folder, so one command is enough.
 * It never touches a brain it did not start, and a failure only logs: the client retries.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

const DEFAULT_ADDR = '127.0.0.1:47321';

export interface LaunchOptions {
  env: NodeJS.ProcessEnv;
  /** The repo's brain/ folder; absent in a packaged app, where nothing is spawned. */
  brainDir: string;
  platform: NodeJS.Platform;
  /** True when something accepts a connection at host:port. */
  probe: (addr: string) => Promise<boolean>;
  exists: (path: string) => boolean;
  spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  log: { info: (line: string) => void; warn: (line: string) => void };
}

export interface BrainProcess {
  /** Stops the child this desktop started; nothing if it started none. */
  stop: () => void;
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

function pipeLines(stream: NodeJS.EventEmitter, write: (line: string) => void): void {
  stream.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim() !== '') write(`[brain] ${line}`);
    }
  });
}

export function realLaunch(
  brainDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BrainProcess> {
  return launchBrain({
    env,
    brainDir,
    platform: process.platform,
    probe: probeAddr,
    exists: existsSync,
    spawn: nodeSpawn,
    log: { info: (line) => console.log(line), warn: (line) => console.warn(line) },
  });
}

export async function launchBrain(options: LaunchOptions): Promise<BrainProcess> {
  const { env, brainDir, platform, probe, exists, spawn, log } = options;
  const none: BrainProcess = { stop: () => undefined };
  const addr = env.TAGALONG_BRAIN_ADDR ?? DEFAULT_ADDR;
  if (env.TAGALONG_START_BRAIN === '0' || !isLocal(addr)) return none;
  if (!exists(join(brainDir, 'pyproject.toml'))) return none;
  if (await probe(addr)) return none;

  const child = spawn('uv', ['run', 'brain'], {
    cwd: brainDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let running = true;
  pipeLines(child.stdout as NodeJS.EventEmitter, log.info);
  pipeLines(child.stderr as NodeJS.EventEmitter, log.warn);
  child.once('error', (error) => {
    running = false;
    log.warn(`could not start the brain (${error.message}); the desktop keeps retrying`);
  });
  child.once('exit', (code) => {
    if (!running) return;
    running = false;
    log.warn(`brain exited with code ${code}; the desktop keeps retrying`);
  });

  return {
    stop: () => {
      if (!running) return;
      running = false;
      // uv starts python as a child; /t takes the whole tree down with it.
      if (platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {});
      else child.kill();
    },
  };
}
