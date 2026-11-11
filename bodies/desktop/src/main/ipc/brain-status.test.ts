/**
 * Tests for Scout's brain card and the version check around it: the card reads the brain's
 * own answer, keeps what the desktop knows while offline, never restarts a brain the person
 * started, and puts the build id only in the copied details.
 */
import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { createBrainStatus, registerBrainStatusIpc } from './brain-status';
import type { BrainStatusDeps } from './brain-status';
import { fakeIpc } from './fake-ipc';

const OURS = { version: '0.9.2', build: 'a1b2c3d4e5f6' };
const WIRE = {
  version: '0.9.2',
  build: 'a1b2c3d4e5f6',
  pid: 4242,
  started_at: '2026-11-10T08:00:00Z',
  started_by: 'desktop',
  addr: '127.0.0.1:47321',
  data_dir: 'C:/Users/me/.tagalong',
  log_path: 'C:/Users/me/.tagalong/brain.log',
  places: [{ id: 'desktop', kind: 'desktop', name: 'Desktop' }],
  work_running: false,
};

function setup(over: { wire?: object | 'missing'; link?: string; hello?: object } = {}) {
  const log: string[] = [];
  const stops: number[] = [];
  const relaunches: number[] = [];
  const copied: string[] = [];
  const opened: string[] = [];
  let wire = over.wire ?? WIRE;
  const deps: BrainStatusDeps = {
    brain: {
      addr: '127.0.0.1:47321',
      link: (over.link ?? 'online') as 'online',
      call: () =>
        wire === 'missing'
          ? Promise.reject(new Error('no such tool'))
          : Promise.resolve([{ type: 'text' as const, text: JSON.stringify(wire) }]),
    },
    ours: OURS,
    fallback: { dataDir: 'C:/fallback', logPath: 'C:/fallback/brain.log' },
    stop: () => Promise.resolve(stops.push(1) > 0),
    relaunch: () => Promise.resolve(void relaunches.push(1)),
    openPath: (path) => Promise.resolve(void opened.push(path)),
    copy: (text) => void copied.push(text),
    log: (line) => void log.push(line),
    onChange: () => undefined,
  };
  const status = createBrainStatus(deps);
  return {
    status,
    log,
    stops,
    relaunches,
    copied,
    opened,
    setWire: (next: object) => (wire = next),
  };
}

describe('brain card', () => {
  it('reads brain_status and parses', async () => {
    const { status } = setup();
    expect(await status.card()).toEqual({
      status: 'running',
      update: 'none',
      version: '0.9.2',
      startedAt: '2026-11-10T08:00:00Z',
      startedBy: 'desktop',
      addr: '127.0.0.1:47321',
      pid: 4242,
      dataDir: 'C:/Users/me/.tagalong',
      logPath: 'C:/Users/me/.tagalong/brain.log',
      places: [{ id: 'desktop', kind: 'desktop', name: 'Desktop' }],
      workRunning: false,
    });
  });

  it('offline card keeps addr, data folder and log', async () => {
    const { status } = setup({ link: 'offline' });
    expect(await status.card()).toMatchObject({
      status: 'offline',
      version: null,
      pid: null,
      startedBy: null,
      addr: '127.0.0.1:47321',
      dataDir: 'C:/fallback',
      logPath: 'C:/fallback/brain.log',
      places: [],
    });
  });

  it('an old brain without brain_status is running with unknown facts', async () => {
    const { status } = setup({ wire: 'missing' });
    expect(await status.card()).toMatchObject({ status: 'running', startedBy: null, pid: null });
  });
});

describe('restart', () => {
  it('restart is refused for a person-started brain', async () => {
    const { status, stops } = setup({ wire: { ...WIRE, started_by: 'person' } });
    await expect(status.restart()).rejects.toThrow();
    expect(stops).toHaveLength(0);
  });

  it('stops the brain then starts it again', async () => {
    const { status, stops, relaunches } = setup();
    await status.restart();
    expect(stops).toHaveLength(1);
    expect(relaunches).toHaveLength(1);
  });

  it('after work waits for the job to finish', async () => {
    const { status, stops, setWire } = setup({ wire: { ...WIRE, work_running: true } });
    await status.restartAfterWork();
    expect(stops).toHaveLength(0);
    setWire(WIRE);
    await status.jobsChanged();
    expect(stops).toHaveLength(1);
  });
});

describe('check on hello', () => {
  it('a current brain is left alone', async () => {
    const { status, stops } = setup();
    await status.check({ version: '0.9.2', build: 'a1b2c3d4e5f6' });
    expect(stops).toHaveLength(0);
    expect((await status.card()).update).toBe('none');
  });

  it('an older brain the desktop started restarts quietly, logging one line', async () => {
    const { status, stops, relaunches, log } = setup();
    await status.check({ version: '0.9.1', build: 'old' });
    expect(stops).toHaveLength(1);
    expect(relaunches).toHaveLength(1);
    expect(log).toHaveLength(1);
  });

  it('a second mismatch in the same run shows the banner instead of restarting', async () => {
    const { status, stops } = setup();
    await status.check({ version: '0.9.1', build: 'old' });
    await status.check({ version: '0.9.1', build: 'old' });
    expect(stops).toHaveLength(1);
    expect((await status.card()).update).toBe('ready');
  });

  it('a person-started brain is never stopped and the card says terminal', async () => {
    const { status, stops } = setup({ wire: { ...WIRE, started_by: 'person' } });
    await status.check({ version: '0.9.1', build: 'old' });
    expect(stops).toHaveLength(0);
    expect((await status.card()).update).toBe('terminal');
  });

  it('a brain with no version and no brain_status asks and is not stopped', async () => {
    const { status, stops } = setup({ wire: 'missing' });
    await status.check({});
    expect(stops).toHaveLength(0);
    expect((await status.card()).update).toBe('ready');
  });

  it('running work shows the banner instead of stopping the brain', async () => {
    const { status, stops } = setup({ wire: { ...WIRE, work_running: true } });
    await status.check({ version: '0.9.1', build: 'old' });
    expect(stops).toHaveLength(0);
    expect((await status.card()).update).toBe('ready');
  });
});

describe('details and folders', () => {
  it('copy details includes the build id', async () => {
    const { status, copied } = setup();
    await status.copyDetails();
    expect(copied[0]).toContain('a1b2c3d4e5f6');
    expect(copied[0]).toContain('4242');
    expect(copied[0]).toContain('127.0.0.1:47321');
    expect(copied[0]).toContain('C:/Users/me/.tagalong');
    expect(copied[0]).toContain('desktop');
  });

  it('opens the data folder and the log from the card', async () => {
    const { status, opened } = setup();
    await status.openFolder();
    await status.openLog();
    expect(opened).toEqual(['C:/Users/me/.tagalong', 'C:/Users/me/.tagalong/brain.log']);
  });
});

describe('registerBrainStatusIpc', () => {
  it('registers every brain card channel', async () => {
    const ipc = fakeIpc();
    const { status } = setup();
    registerBrainStatusIpc(ipc.handle, status);
    expect(ipc.channels()).toEqual(
      [
        IPC.brainStatus,
        IPC.brainRestart,
        IPC.brainRestartAfterWork,
        IPC.brainOpenFolder,
        IPC.brainOpenLog,
        IPC.brainCopyDetails,
      ].sort(),
    );
    expect(await ipc.invoke(IPC.brainStatus)).toMatchObject({ status: 'running' });
  });
});
