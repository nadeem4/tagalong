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
  model: 'Claude Opus 5.5',
};

function setup(
  over: { wire?: object | 'missing'; link?: string; hello?: object; paired?: boolean } = {},
) {
  const log: string[] = [];
  const stops: number[] = [];
  const relaunches: number[] = [];
  const reinstalls: number[] = [];
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
    paired: () => (over.paired === true ? { fp: 'ab12cd34ef56' } : null),
    now: () => new Date('2026-11-24T08:41:00Z'),
    fallback: { dataDir: 'C:/fallback', logPath: 'C:/fallback/brain.log' },
    stop: () => Promise.resolve(stops.push(1) > 0),
    relaunch: () => Promise.resolve(void relaunches.push(1)),
    restartService: () => Promise.resolve(reinstalls.push(1) > 0),
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
    reinstalls,
    copied,
    opened,
    setWire: (next: object | 'missing') => (wire = next),
    brain: deps.brain,
  };
}

describe('brain card', () => {
  it('reads brain_status and parses', async () => {
    const { status } = setup();
    expect(await status.card()).toEqual({
      status: 'running',
      update: 'none',
      version: '0.9.2',
      build: 'a1b2c3d4e5f6',
      appVersion: '0.9.2',
      appBuild: 'a1b2c3d4e5f6',
      startedAt: '2026-11-10T08:00:00Z',
      startedBy: 'desktop',
      addr: '127.0.0.1:47321',
      pid: 4242,
      dataDir: 'C:/Users/me/.tagalong',
      logPath: 'C:/Users/me/.tagalong/brain.log',
      places: [{ id: 'desktop', kind: 'desktop', name: 'Desktop' }],
      workRunning: false,
      model: 'Claude Opus 5.5',
      lastConnected: '2026-11-24T08:41:00.000Z',
    });
  });

  it('an older brain that does not name its model still gives a card, with no model', async () => {
    const { model: _model, ...old } = WIRE;
    const { status } = setup({ wire: old });
    expect(await status.card()).toMatchObject({ status: 'running', model: null });
  });

  it('offline card keeps the model last seen', async () => {
    const { status, brain } = setup();
    await status.card();
    (brain as { link: string }).link = 'offline';
    expect(await status.card()).toMatchObject({ status: 'offline', model: 'Claude Opus 5.5' });
  });

  it('offline card that never saw the brain has no model', async () => {
    expect(await setup({ link: 'offline' }).status.card()).toMatchObject({ model: null });
  });

  it('offline card keeps addr, data folder and log', async () => {
    const { status } = setup({ link: 'offline' });
    expect(await status.card()).toMatchObject({
      status: 'offline',
      version: null,
      build: null,
      appVersion: '0.9.2',
      appBuild: 'a1b2c3d4e5f6',
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

  it('stop ends a brain the desktop or the service started, and refuses the person-started one', async () => {
    const mine = setup();
    await mine.status.stop();
    expect(mine.stops).toHaveLength(1);
    expect(mine.relaunches).toHaveLength(0);
    const theirs = setup({ wire: { ...WIRE, started_by: 'person' } });
    await expect(theirs.status.stop()).rejects.toThrow();
    expect(theirs.stops).toHaveLength(0);
  });

  it('reports whether it listens for other devices and when the link last answered', async () => {
    const { status, brain } = setup({ wire: { ...WIRE, network: true } });
    expect(await status.card()).toMatchObject({
      network: true,
      lastConnected: '2026-11-24T08:41:00.000Z',
    });
    (brain as { link: string }).link = 'offline';
    expect(await status.card()).toMatchObject({ lastConnected: '2026-11-24T08:41:00.000Z' });
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

describe('restart after work with unknown facts', () => {
  it('an old brain with no brain_status is never restarted behind a waiting job', async () => {
    const { status, stops } = setup({ wire: 'missing' });
    await status.restartAfterWork();
    await status.jobsChanged();
    expect(stops).toHaveLength(0);
  });

  it('facts that go missing while waiting keep it waiting', async () => {
    const { status, stops, setWire } = setup({ wire: { ...WIRE, work_running: true } });
    await status.restartAfterWork();
    setWire('missing');
    await status.jobsChanged();
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

  it('an older brain the logon service runs is reinstalled, not stopped and relaunched', async () => {
    const { status, stops, relaunches, reinstalls } = setup({
      wire: { ...WIRE, started_by: 'service' },
    });
    await status.check({ version: '0.9.1', build: 'old' });
    expect(reinstalls).toHaveLength(1);
    expect(stops).toHaveLength(0);
    expect(relaunches).toHaveLength(0);
    expect((await status.card()).update).toBe('none');
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
    expect(copied[0]).toContain('Model: Claude Opus 5.5');
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
        IPC.brainStop,
        IPC.brainOpenFolder,
        IPC.brainOpenLog,
        IPC.brainCopyDetails,
      ].sort(),
    );
    expect(await ipc.invoke(IPC.brainStatus)).toMatchObject({ status: 'running' });
  });
});

describe('a brain on another machine', () => {
  const REMOTE = { ...WIRE, host: 'HOME-PC', local: false };

  it('names its host on the card', async () => {
    const { status } = setup({ wire: REMOTE });
    expect(await status.card()).toMatchObject({ host: 'HOME-PC', local: false });
  });

  it('is remote because the link is paired, so an unreachable brain is not offered a restart', async () => {
    const { status, brain, stops } = setup({ wire: REMOTE, paired: true });
    await status.card();
    (brain as { link: string }).link = 'offline';
    expect(await status.card()).toMatchObject({
      status: 'offline',
      host: 'HOME-PC',
      local: false,
    });
    await status.restart();
    expect(stops).toEqual([]);
  });

  it('is remote from the first card when the link is paired, even before the brain has answered', async () => {
    const { status } = setup({ wire: 'missing', paired: true });
    expect(await status.card()).toMatchObject({ local: false });
  });

  it('shows the pinned certificate as a short code to check against the other machine', async () => {
    const { status } = setup({ wire: REMOTE, paired: true });
    expect(await status.card()).toMatchObject({ identity: 'AB12-CD34' });
  });

  it('is not restarted, not even by an older build', async () => {
    const { status, stops, relaunches } = setup({ wire: { ...REMOTE, version: '0.1.0' } });
    await status.restart();
    await status.check({ version: '0.1.0', build: 'old' });
    expect(stops).toEqual([]);
    expect(relaunches).toEqual([]);
    expect((await status.card()).update).toBe('none');
  });

  it('opens no data folder, while a local brain still opens it', async () => {
    const remote = setup({ wire: REMOTE });
    await remote.status.openFolder();
    expect(remote.opened).toEqual([]);
    const local = setup({ wire: { ...WIRE, host: 'HOME-PC', local: true } });
    await local.status.openFolder();
    expect(local.opened).toEqual(['C:/Users/me/.tagalong']);
  });
});
