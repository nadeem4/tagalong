/** Tests for launchBrain: when it spawns `uv run brain`, what it passes, and that it never stops it. */
import type { SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brainLogPath, isLocal, launchBrain, packagedEnv, probeAddr, stopBrain } from './launch';
import type { LaunchOptions } from './launch';

class FakeChild extends EventEmitter {
  pid = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  unrefed = false;
  unref(): void {
    this.unrefed = true;
  }
}

function setup(over: Partial<LaunchOptions> = {}) {
  const spawned: { cmd: string; args: string[]; opts: SpawnOptions }[] = [];
  const children: FakeChild[] = [];
  const err: string[] = [];
  const opened: string[] = [];
  const closed: number[] = [];
  const setups: string[] = [];
  const options: LaunchOptions = {
    env: {},
    brainDir: 'C:/repo/brain',
    logPath: 'C:/home/brain.log',
    openLog: (path) => (opened.push(path), 77),
    closeLog: (fd) => void closed.push(fd),
    probe: async () => false,
    exists: () => true,
    spawn: (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      const child = new FakeChild();
      children.push(child);
      return child as never;
    },
    log: { warn: (line) => err.push(line) },
    uv: 'uv',
    sync: false,
    platform: 'linux',
    onSetup: (state) => void setups.push(state),
    ...over,
  };
  return { options, spawned, children, err, opened, closed, setups };
}

describe('isLocal', () => {
  it('accepts loopback hosts only', () => {
    expect(isLocal('127.0.0.1:47321')).toBe(true);
    expect(isLocal('localhost:1')).toBe(true);
    expect(isLocal('[::1]:1')).toBe(true);
    expect(isLocal('10.0.0.5:9000')).toBe(false);
  });
});

describe('launchBrain', () => {
  it('spawns uv run brain in the brain folder with the environment passed through', async () => {
    const env = { TAGALONG_BRAIN_ADDR: '127.0.0.1:50000' };
    const { options, spawned } = setup({ env });
    await launchBrain(options);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ cmd: 'uv', args: ['run', 'brain'] });
    expect(spawned[0]?.opts).toMatchObject({ cwd: 'C:/repo/brain', env });
  });

  it('probes the address it was given, defaulting to the brain port', async () => {
    const seen: string[] = [];
    await launchBrain(setup({ probe: async (a) => (seen.push(a), true) }).options);
    await launchBrain(
      setup({
        env: { TAGALONG_BRAIN_ADDR: 'localhost:50000' },
        probe: async (a) => (seen.push(a), true),
      }).options,
    );
    expect(seen).toEqual(['127.0.0.1:47321', 'localhost:50000']);
  });

  it('does not spawn when something already answers', async () => {
    const { options, spawned } = setup({ probe: async () => true });
    await launchBrain(options);
    expect(spawned).toEqual([]);
  });

  it('does not spawn for a remote address, and does not probe it', async () => {
    let probed = false;
    const { options, spawned } = setup({
      env: { TAGALONG_BRAIN_ADDR: '10.0.0.5:9000' },
      probe: async () => ((probed = true), false),
    });
    await launchBrain(options);
    expect(spawned).toEqual([]);
    expect(probed).toBe(false);
  });

  it('does not spawn when there is no brain folder', async () => {
    const { options, spawned } = setup({ exists: () => false });
    await launchBrain(options);
    expect(spawned).toEqual([]);
  });

  it('does not spawn when TAGALONG_START_BRAIN is 0', async () => {
    const { options, spawned } = setup({ env: { TAGALONG_START_BRAIN: '0' } });
    await launchBrain(options);
    expect(spawned).toEqual([]);
  });

  it('spawns the brain detached, logging to brain.log, and lets go of it', async () => {
    const { options, spawned, children, opened, closed } = setup();
    const result = await launchBrain(options);
    expect(opened).toEqual(['C:/home/brain.log']);
    expect(spawned[0]?.opts).toMatchObject({
      detached: true,
      stdio: ['ignore', 77, 77],
      windowsHide: true,
    });
    expect(children[0]?.unrefed).toBe(true);
    expect(closed).toEqual([77]);
    expect(result).toBeUndefined();
  });

  it('on Windows starts the brain hidden, not detached, so no console window opens', async () => {
    // Detached on Windows means no console; uv's console child then gets a new, visible one.
    // Hidden (not detached), the brain shares uv's hidden console and still outlives the app.
    const { options, spawned, children } = setup({ platform: 'win32' });
    await launchBrain(options);
    expect(spawned[0]?.opts.detached).toBe(false);
    expect(spawned[0]?.opts.windowsHide).toBe(true);
    expect(children[0]?.unrefed).toBe(true);
  });

  it('leaves a running brain alone and opens no log', async () => {
    const { options, spawned, opened } = setup({ probe: async () => true });
    await launchBrain(options);
    expect(spawned).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('logs one line when spawning fails, and does not respawn', async () => {
    const { options, children, err, spawned } = setup();
    await launchBrain(options);
    children[0]?.emit('error', new Error('spawn uv ENOENT'));
    children[0]?.emit('exit', null);
    expect(err.filter((l) => l.includes('ENOENT'))).toHaveLength(1);
    expect(spawned).toHaveLength(1);
  });

  it('logs one line when the child exits', async () => {
    const { options, children, err } = setup();
    await launchBrain(options);
    children[0]?.emit('exit', 1);
    expect(err).toEqual(['brain exited with code 1; the desktop keeps retrying']);
  });
});

/** A spawn that finishes the sync child with this exit code, then hands out ordinary children. */
function syncing(code: number | null, error?: Error) {
  const calls: { cmd: string; args: string[]; opts: SpawnOptions }[] = [];
  const spawn: LaunchOptions['spawn'] = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new FakeChild();
    if (args[0] === 'sync') {
      queueMicrotask(() => (error ? child.emit('error', error) : child.emit('exit', code)));
    }
    return child as never;
  };
  return { calls, spawn };
}

describe('launchBrain first run (sync)', () => {
  it('runs uv sync before the brain, as argv without a shell, then starts the brain with --frozen', async () => {
    const { calls, spawn } = syncing(0);
    const { options, setups, opened } = setup({ sync: true, uv: 'C:/res/uv/uv.exe', spawn });
    await launchBrain(options);
    expect(calls.map((c) => [c.cmd, c.args])).toEqual([
      ['C:/res/uv/uv.exe', ['sync', '--frozen', '--no-dev']],
      ['C:/res/uv/uv.exe', ['run', '--frozen', '--no-dev', 'brain']],
    ]);
    expect(calls[0]?.opts).toMatchObject({ cwd: 'C:/repo/brain', windowsHide: true });
    expect(calls[0]?.opts.shell).toBeUndefined();
    expect(calls[0]?.opts.detached).toBeFalsy();
    expect(calls[1]?.opts).toMatchObject({ detached: true, windowsHide: true });
    expect(calls[1]?.opts.shell).toBeUndefined();
    expect(setups).toEqual(['installing', 'idle']);
    expect(opened).toHaveLength(2);
  });

  it('does not sync, or report installing, when the brain already answers', async () => {
    const { calls, spawn } = syncing(0);
    const { options, setups } = setup({ sync: true, spawn, probe: async () => true });
    await launchBrain(options);
    expect(calls).toEqual([]);
    expect(setups).toEqual([]);
  });

  it('does not sync in dev, and runs plain uv run brain', async () => {
    const { calls, spawn } = syncing(0);
    await launchBrain(setup({ sync: false, spawn }).options);
    expect(calls.map((c) => c.args)).toEqual([['run', 'brain']]);
  });

  it('a failed sync reports failed, logs one line and never starts the brain', async () => {
    const { calls, spawn } = syncing(2);
    const { options, setups, err } = setup({ sync: true, spawn });
    await launchBrain(options);
    expect(calls).toHaveLength(1);
    expect(setups).toEqual(['installing', 'failed']);
    expect(err).toHaveLength(1);
  });

  it('a sync that cannot start (no uv.exe) is a failure too', async () => {
    const { calls, spawn } = syncing(0, new Error('spawn ENOENT'));
    const { options, setups } = setup({ sync: true, spawn });
    await launchBrain(options);
    expect(calls).toHaveLength(1);
    expect(setups).toEqual(['installing', 'failed']);
  });

  it('retrying after a failure syncs again and starts the brain', async () => {
    let code = 1;
    const calls: string[][] = [];
    const spawn: LaunchOptions['spawn'] = (_cmd, args) => {
      calls.push(args);
      const child = new FakeChild();
      if (args[0] === 'sync') queueMicrotask(() => child.emit('exit', code));
      return child as never;
    };
    const { options, setups } = setup({ sync: true, spawn });
    await launchBrain(options);
    code = 0;
    await launchBrain(options);
    expect(setups).toEqual(['installing', 'failed', 'installing', 'idle']);
    expect(calls.map((a) => a[0])).toEqual(['sync', 'sync', 'run']);
  });

  it('keeps a home path with a space and a non-ASCII letter as one argument and one env value', async () => {
    const home = 'C:/Users/Zoë Müller/.tagalong';
    const uv = 'C:/Program Files/Tagalong/uv.exe';
    const env = packagedEnv({ TAGALONG_HOME: home }, 'C:/Users/x', '0.9.2');
    const { calls, spawn } = syncing(0);
    await launchBrain(setup({ sync: true, spawn, env, uv }).options);
    expect(calls[0]?.cmd).toBe(uv);
    expect(calls[0]?.args).toEqual(['sync', '--frozen', '--no-dev']);
    expect(calls[0]?.opts.env?.UV_PROJECT_ENVIRONMENT).toBe(join(home, 'runtime', 'venv'));
  });
});

describe('started by and stop', () => {
  it('spawned brain is told the desktop started it', async () => {
    const { options, spawned } = setup({ env: { KEEP: '1' } });
    await launchBrain(options);
    expect(spawned[0]?.opts.env).toMatchObject({ KEEP: '1', TAGALONG_STARTED_BY: 'desktop' });
  });

  it('packaged env carries TAGALONG_BUILD', () => {
    expect(packagedEnv({}, 'C:/Users/me', '0.9.2').TAGALONG_BUILD).toBe('0.9.2');
  });

  it('stopBrain runs tagalong stop with the brain env', async () => {
    const { options, spawned } = setup({ env: { KEEP: '1' }, uv: 'C:/uv.exe', sync: true });
    const spawn: LaunchOptions['spawn'] = (cmd, args, opts) => {
      const child = options.spawn(cmd, args, opts);
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    };
    expect(await stopBrain({ ...options, spawn })).toBe(true);
    expect(spawned[0]).toMatchObject({
      cmd: 'C:/uv.exe',
      args: ['run', '--no-sync', 'tagalong', 'stop'],
    });
    expect(spawned[0]?.opts).toMatchObject({ cwd: 'C:/repo/brain', env: { KEEP: '1' } });
  });

  it('stopBrain never syncs, even from a source checkout', async () => {
    // A sync rewrites .venv/Scripts/brain.exe, which the running brain holds open on Windows,
    // so uv fails before `tagalong stop` runs and the brain can never be restarted.
    const { options, spawned } = setup({ sync: false });
    const spawn: LaunchOptions['spawn'] = (cmd, args, opts) => {
      const child = options.spawn(cmd, args, opts);
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    };
    await stopBrain({ ...options, spawn });
    expect(spawned[0]?.args).toEqual(['run', '--no-sync', 'tagalong', 'stop']);
  });

  it('stopBrain is false when the command fails or cannot start', async () => {
    const { options } = setup();
    const exits =
      (code: number): LaunchOptions['spawn'] =>
      (cmd, args, opts) => {
        const child = options.spawn(cmd, args, opts);
        queueMicrotask(() => child.emit('exit', code));
        return child;
      };
    expect(await stopBrain({ ...options, spawn: exits(1) })).toBe(false);
    const broken: LaunchOptions['spawn'] = (cmd, args, opts) => {
      const child = options.spawn(cmd, args, opts);
      queueMicrotask(() => child.emit('error', new Error('spawn ENOENT')));
      return child;
    };
    expect(await stopBrain({ ...options, spawn: broken })).toBe(false);
  });
});

describe('packagedEnv', () => {
  it('points uv at folders under the Tagalong home, managed Python only', () => {
    const env = packagedEnv({ KEEP: '1' }, 'C:/Users/me', '0.9.2');
    const home = join('C:/Users/me', '.tagalong');
    expect(env).toMatchObject({
      KEEP: '1',
      UV_PROJECT_ENVIRONMENT: join(home, 'runtime', 'venv'),
      UV_PYTHON_INSTALL_DIR: join(home, 'runtime', 'python'),
      UV_CACHE_DIR: join(home, 'cache', 'uv'),
      UV_PYTHON_PREFERENCE: 'only-managed',
    });
  });

  it('follows TAGALONG_HOME', () => {
    expect(packagedEnv({ TAGALONG_HOME: 'D:/t' }, 'C:/Users/me', '0.9.2').UV_CACHE_DIR).toBe(
      join('D:/t', 'cache', 'uv'),
    );
  });
});

describe('launchBrain dev env', () => {
  it('sets no UV_ variables when not packaged', async () => {
    const { options, spawned } = setup({ env: { A: '1' } });
    await launchBrain(options);
    expect(Object.keys(spawned[0]?.opts.env ?? {}).filter((k) => k.startsWith('UV_'))).toEqual([]);
  });
});

describe('brainLogPath', () => {
  it('follows TAGALONG_HOME, else the .tagalong folder in the home directory', () => {
    expect(brainLogPath({ TAGALONG_HOME: 'D:/t' }, 'C:/Users/me')).toBe(join('D:/t', 'brain.log'));
    expect(brainLogPath({}, 'C:/Users/me')).toBe(join('C:/Users/me', '.tagalong', 'brain.log'));
  });
});

describe('probeAddr', () => {
  it('is true when something listens and false when the connection is refused', async () => {
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    expect(await probeAddr(`127.0.0.1:${port}`)).toBe(true);
    await new Promise((r) => server.close(r));
    expect(await probeAddr(`127.0.0.1:${port}`)).toBe(false);
  });
});
