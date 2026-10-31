/** Tests for launchBrain: when it spawns `uv run brain`, what it passes, and how it stops. */
import type { SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { isLocal, launchBrain, probeAddr } from './launch';
import type { LaunchOptions } from './launch';

class FakeChild extends EventEmitter {
  pid = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill(): void {
    this.killed = true;
  }
}

function setup(over: Partial<LaunchOptions> = {}) {
  const spawned: { cmd: string; args: string[]; opts: SpawnOptions }[] = [];
  const children: FakeChild[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const options: LaunchOptions = {
    env: {},
    brainDir: 'C:/repo/brain',
    platform: 'win32',
    probe: async () => false,
    exists: () => true,
    spawn: (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      const child = new FakeChild();
      children.push(child);
      return child as never;
    },
    log: { info: (line) => out.push(line), warn: (line) => err.push(line) },
    ...over,
  };
  return { options, spawned, children, out, err };
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

  it('pipes the child output into the log', async () => {
    const { options, children, out, err } = setup();
    await launchBrain(options);
    children[0]?.stdout.emit('data', Buffer.from('listening\nready\n'));
    children[0]?.stderr.emit('data', Buffer.from('oops\n'));
    expect(out).toEqual(['[brain] listening', '[brain] ready']);
    expect(err).toEqual(['[brain] oops']);
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

  it('stop kills the process tree on Windows', async () => {
    const { options, spawned } = setup();
    const handle = await launchBrain(options);
    handle.stop();
    expect(spawned[1]).toMatchObject({ cmd: 'taskkill', args: ['/pid', '4242', '/t', '/f'] });
  });

  it('stop kills the child directly elsewhere', async () => {
    const { options, children } = setup({ platform: 'linux' });
    const handle = await launchBrain(options);
    handle.stop();
    expect(children[0]?.killed).toBe(true);
  });

  it('stop does nothing when it started no child', async () => {
    const { options, spawned } = setup({ probe: async () => true });
    const handle = await launchBrain(options);
    handle.stop();
    expect(spawned).toEqual([]);
  });

  it('stop does nothing once the child has exited', async () => {
    const { options, children, spawned } = setup();
    const handle = await launchBrain(options);
    children[0]?.emit('exit', 0);
    handle.stop();
    expect(spawned).toHaveLength(1);
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
