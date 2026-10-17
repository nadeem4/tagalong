/**
 * Tests for CheckIn: the gate (toggles, budget, one in flight, cap, cooldown, Not now, calls,
 * blind spots), silence, delivery, offers and their accept, and the tired face. A fake mind
 * answers; no test pins the mind's wording.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Expert, Settings } from '@tagalong/protocol';
import type {
  Brief,
  LaunchFacts,
  PetMoodParams,
  PetRemarkParams,
  PickUpReadyParams,
  WindowEntry,
} from '@tagalong/protocol';
import type { PickUpReady } from '../pick-up/pick-up';
import type { Arrival } from './arrivals';
import type { PerceptionHost } from '../perception';
import type { Memory } from '../memory/memories';
import { soul } from '../roles';
import { SETTLE_MS } from '../keep-an-eye/lookout';
import { BREAK_MS, STRETCH_MS } from './active-time';
import { CHECK_IN_DAILY_CAP, COOLDOWN_MS, CheckIn, NOT_NOW_MS } from './check-in';
import { CHECK_IN_INSTRUCTIONS } from './reply';
import { fakeMind, scout, sentText, win, type MindStep } from './test-support';

const MINUTE = 60_000;
const KEY = 'sk-abcdefghijklmnopqrstuvwxyz0123';

const claudeCode = Expert.parse({
  id: 'claude-code',
  name: 'Claude Code',
  goodAt: 'code',
  connection: { type: 'claude-code' },
});
const writer = Expert.parse({ id: 'writer', name: 'Writer', connection: { type: 'claude-code' } });

const failing = win('w-9', 'npm test - failed - ai_pet', { processName: 'WindowsTerminal.exe' });
const editor = win('w-1', 'parser.ts - ai_pet - Code');

interface SetupOptions {
  mind?: MindStep[];
  settings?: Record<string, unknown>;
  experts?: Expert[];
  spentOut?: boolean;
  noPet?: boolean;
  text?: string;
  hostWindows?: WindowEntry[] | null;
  memories?: Memory[];
  /** A pick-up ready to take, once. */
  pickUp?: PickUpReady | null;
  routines?: string[];
  interrupted?: number;
  recentWork?: string[];
}

function setup(options: SetupOptions = {}) {
  const clock = { t: 10 * 24 * 60 * MINUTE, now: () => clock.t };
  const state = {
    settings: Settings.parse({ wellbeing: { enabled: true }, ...options.settings }),
    spentOut: options.spentOut ?? false,
    pet: options.noPet === true ? null : scout,
    blocked: false,
    readFails: false,
    /** The store behind it closed: every source throws. */
    closed: false,
    text: options.text ?? `Error: listen EADDRINUSE :3000 ${KEY}`,
    hour: 14,
  };
  const logs: string[] = [];
  const queries: string[] = [];
  const closedCheck = () => {
    if (state.closed) throw new Error('The database connection is not open');
  };
  const mind = fakeMind(...(options.mind ?? ['NOTHING']));
  const reads: Array<string | undefined> = [];
  const remarks: PetRemarkParams[] = [];
  const moods: PetMoodParams['mood'][] = [];
  const pickUps: PickUpReadyParams[] = [];
  const pickUp = { ready: options.pickUp ?? null, takes: 0 };
  const routinesSince: string[] = [];
  const reported: string[][] = [];
  const proposals: Array<{ expertId: string; petId: string; brief: Brief; projectHint?: string }> =
    [];
  const host: PerceptionHost = {
    capabilities: ['textLayer'],
    capture: () => Promise.resolve({}),
    readText: ({ windowId }) => {
      reads.push(windowId);
      if (state.readFails) return Promise.reject(new Error('UIA timed out'));
      return Promise.resolve({
        windowId: windowId ?? 'w-?',
        text: state.blocked ? '' : state.text,
        truncated: false,
        source: 'uia',
        ...(state.blocked ? { blocked: { rule: 'processName', entry: 'x.exe' } } : {}),
      });
    },
  };
  const checkIn = new CheckIn({
    clock,
    hourOf: () => state.hour,
    settings: () => state.settings,
    pet: () => {
      if (state.closed && mind.requests.length > 0) closedCheck();
      return state.pet;
    },
    provider: mind.resolve,
    hosts: () => [host],
    windows: () => Promise.resolve(options.hostWindows === undefined ? [] : options.hostWindows),
    experts: () => options.experts ?? [claudeCode],
    now: { clock: () => new Date(clock.t), timeZone: () => 'Europe/London' },
    memories: (query) => {
      closedCheck();
      queries.push(query);
      return { memories: options.memories ?? [], recentWork: options.recentWork ?? [] };
    },
    lastExchange: () => {
      closedCheck();
      return { said: 'Why is port 3000 taken?', answered: 'An old server still holds it.' };
    },
    routinesSince: (iso) => {
      routinesSince.push(iso);
      return options.routines ?? [];
    },
    interruptedAtBoot: options.interrupted ?? 0,
    takePickUp: () => {
      pickUp.takes += 1;
      const ready = pickUp.ready;
      pickUp.ready = null;
      return ready;
    },
    reported: (jobIds) => reported.push([...jobIds]),
    propose: (params) => proposals.push(params),
    emit: (event) => {
      if (event.method === 'pet.remark') remarks.push(event.params);
      else if (event.method === 'pickUp.ready') pickUps.push(event.params);
      else moods.push(event.params.mood);
    },
    spentOut: () => state.spentOut,
    log: (message) => logs.push(message),
  });
  /** The front window settles, then one snapshot past the thirty seconds. */
  const settle = async (window: WindowEntry = editor): Promise<void> => {
    await checkIn.observeWindows([window]);
    clock.t += SETTLE_MS;
    await checkIn.observeWindows([window]);
  };
  /** One-minute activity ticks until a long stretch is due, then that tick. */
  const stretch = async (windows: WindowEntry[] = [editor]): Promise<void> => {
    for (let i = 0; i <= STRETCH_MS / MINUTE; i += 1) {
      clock.t += MINUTE;
      await checkIn.observeActivity({ idleMs: 0, windows });
    }
  };
  return {
    clock,
    state,
    mind,
    reads,
    remarks,
    moods,
    pickUps,
    pickUp,
    routinesSince,
    reported,
    proposals,
    logs,
    queries,
    checkIn,
    settle,
    stretch,
  };
}

const HANDOFF_ID = '00000000-0000-4000-8000-000000000001';
const finishedDone: Arrival = {
  id: 'h-0000',
  kind: 'expert',
  title: 'Claude Code: "fix the login test"',
  state: 'done',
  note: 'All 12 tests pass now.',
  detail: 'All 12 tests pass now.',
  handoffId: HANDOFF_ID,
};
const job = (n: number): Arrival => ({
  id: `j-000${n}`,
  kind: 'job',
  title: `task ${n}`,
  state: 'done',
  note: `gist ${n}`,
  jobId: `job-${n}`,
});

afterEach(() => vi.useRealTimers());

describe('CheckIn: the gate', () => {
  it('each reason waits for its own switch', async () => {
    const eye = setup({ settings: { keepAnEye: false } });
    await eye.checkIn.observeWindows([failing]);
    await eye.settle();
    expect(eye.mind.requests).toHaveLength(0);

    const nudges = setup({ settings: { wellbeing: { enabled: false } } });
    await nudges.stretch();
    expect(nudges.mind.requests).toHaveLength(0);

    // A finished hand-off is work they asked for: no switch.
    const done = setup({ settings: { keepAnEye: false, wellbeing: { enabled: false } } });
    await done.checkIn.finished([finishedDone]);
    expect(done.mind.requests).toHaveLength(1);
  });

  it('with keeping an eye off nothing is tracked: switched on, the thirty seconds start then', async () => {
    const t = setup({ settings: { keepAnEye: false } });
    await t.checkIn.observeWindows([editor]);
    t.clock.t += SETTLE_MS;
    t.state.settings = Settings.parse({ ...t.state.settings, keepAnEye: true });
    await t.checkIn.observeWindows([editor]);
    expect(t.mind.requests).toHaveLength(0);
    t.clock.t += SETTLE_MS;
    await t.checkIn.observeWindows([editor]);
    expect(t.mind.requests).toHaveLength(1);
  });

  it('asks nothing with no pet', async () => {
    const t = setup({ noPet: true });
    await t.checkIn.observeWindows([failing]);
    await t.stretch();
    await t.checkIn.finished([finishedDone]);
    expect(t.mind.requests).toHaveLength(0);
  });

  it('asks nothing once the budget is spent, for every reason', async () => {
    const t = setup({ spentOut: true });
    await t.checkIn.observeWindows([failing]);
    await t.stretch();
    await t.checkIn.finished([finishedDone]);
    expect(t.mind.requests).toHaveLength(0);
    expect(t.reads).toHaveLength(0);
  });

  it('drops a wake while one is in flight', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup({ mind: ['hang'] });
    const first = t.checkIn.observeWindows([failing]);
    await vi.advanceTimersByTimeAsync(0);
    // Finished work is not lost: Arrivals keeps the batch and tries again.
    await expect(t.checkIn.finished([finishedDone])).resolves.toBe(false);
    expect(t.mind.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15_000);
    await first;
    expect(t.remarks).toHaveLength(0);
    const second = t.checkIn.finished([finishedDone]);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(second).resolves.toBe(true);
  });

  it('keeps ten minutes between unprompted wakes; a finished hand-off is exempt', async () => {
    const t = setup();
    await t.checkIn.observeWindows([failing]);
    expect(t.mind.requests).toHaveLength(1);
    const other = win('w-8', 'Build failed - Jenkins');
    t.clock.t += MINUTE;
    await t.checkIn.observeWindows([other]);
    expect(t.mind.requests).toHaveLength(1);
    await t.checkIn.finished([finishedDone]);
    expect(t.mind.requests).toHaveLength(2);
    t.clock.t += COOLDOWN_MS;
    // The cooldown did not use the other window up: it is still there to look at.
    await t.checkIn.observeWindows([other]);
    expect(t.mind.requests).toHaveLength(3);
    expect(sentText(t.mind.requests[2]!)).toContain('Build failed - Jenkins');
  });

  it('Not now quiets unprompted wakes for an hour; a finished hand-off still comes', async () => {
    const t = setup();
    const until = t.checkIn.notNow();
    expect(until.getTime()).toBe(t.clock.t + NOT_NOW_MS);
    await t.checkIn.observeWindows([failing]);
    expect(t.mind.requests).toHaveLength(0);
    await t.checkIn.finished([finishedDone]);
    expect(t.mind.requests).toHaveLength(1);
    t.clock.t += NOT_NOW_MS;
    await t.checkIn.observeWindows([failing]);
    expect(t.mind.requests).toHaveLength(2);
  });

  it('drops a line when Not now is pressed while it is being written', async () => {
    const t = setup({ mind: ['That port is still taken.'] });
    const pending = t.checkIn.observeWindows([failing]);
    t.checkIn.notNow();
    await pending;
    expect(t.mind.requests).toHaveLength(1);
    expect(t.remarks).toHaveLength(0);
  });

  it('stops at the daily cap, and starts again the next day', async () => {
    const t = setup();
    for (let i = 0; i < CHECK_IN_DAILY_CAP; i += 1) await t.checkIn.finished([finishedDone]);
    expect(t.mind.requests).toHaveLength(CHECK_IN_DAILY_CAP);
    await t.checkIn.finished([finishedDone]);
    expect(t.mind.requests).toHaveLength(CHECK_IN_DAILY_CAP);
    t.clock.t += 24 * 60 * MINUTE;
    await t.checkIn.finished([finishedDone]);
    expect(t.mind.requests).toHaveLength(CHECK_IN_DAILY_CAP + 1);
  });

  it('keeps out of the way of a call or a full-screen app in front', async () => {
    const call = win('w-3', 'Meeting', { processName: 'Zoom.exe' });
    const t = setup({ hostWindows: [call] });
    await t.checkIn.observeWindows([call, { ...failing, state: 'background' }]);
    await t.stretch([win('w-4', 'Film', { fullScreen: true })]);
    // Finished work is handed back to Arrivals, which holds it until the call is over.
    await expect(t.checkIn.finished([finishedDone])).resolves.toBe(false);
    expect(t.mind.requests).toHaveLength(0);
    // The error was not used up during the call.
    await t.checkIn.observeWindows([editor, { ...failing, state: 'background' }]);
    expect(t.mind.requests).toHaveLength(1);
  });

  it('never looks at a blind window', async () => {
    const vault = win('w-2', 'Error unlocking vault', { processName: '1Password.exe' });
    const t = setup();
    await t.checkIn.observeWindows([vault]);
    t.clock.t += SETTLE_MS;
    await t.checkIn.observeWindows([vault]);
    expect(t.mind.requests).toHaveLength(0);
    expect(t.reads).toHaveLength(0);
  });

  it('asks nothing when the window cannot be read', async () => {
    const t = setup();
    t.state.blocked = true;
    await t.checkIn.observeWindows([failing]);
    expect(t.reads).toHaveLength(1);
    expect(t.mind.requests).toHaveLength(0);
  });
});

describe('CheckIn: what the mind is given', () => {
  it('the system prompt is the soul and the check-in block, the same for every reason', async () => {
    const t = setup();
    await t.checkIn.observeWindows([failing]);
    await t.checkIn.finished([finishedDone]);
    t.clock.t += COOLDOWN_MS;
    await t.stretch();
    expect(t.mind.requests).toHaveLength(3);
    const system = `${soul()}\n\n${CHECK_IN_INSTRUCTIONS}`;
    for (const request of t.mind.requests) expect(request.system).toBe(system);
  });

  it('a trouble wake sends the window text with secrets hidden; a stretch reads nothing', async () => {
    const t = setup({
      memories: [{ id: 'm', petId: 'scout', kind: 'fact', text: 'Uses pnpm.', createdAt: '' }],
    });
    await t.checkIn.observeWindows([failing]);
    const sent = sentText(t.mind.requests[0]!);
    expect(sent).toContain('EADDRINUSE');
    expect(sent).toContain('- (fact) Uses pnpm.');
    expect(sent).toContain('They said: "Why is port 3000 taken?"');
    expect(sent).toContain('- claude-code: Claude Code.');
    expect(sent).not.toContain(KEY);
    t.clock.t += COOLDOWN_MS;
    await t.stretch();
    expect(t.reads).toHaveLength(1);
    expect(sentText(t.mind.requests[1]!)).toContain('without a break');
  });

  it('recalls with the words of why it woke, and sends the recent work recall found', async () => {
    const t = setup({ recentWork: ['- (your job, today, j-1b2c) "fix the login test": Done.'] });
    await t.checkIn.observeWindows([failing]);
    t.clock.t += COOLDOWN_MS;
    await t.checkIn.finished([finishedDone]);
    expect(t.queries[0]).toContain('npm test - failed - ai_pet');
    expect(t.queries[1]).toContain('fix the login test');
    expect(sentText(t.mind.requests[1]!)).toContain('j-1b2c');
  });

  it('a finished wake sends the expert, the ask and the answer', async () => {
    const t = setup();
    await t.checkIn.finished([finishedDone]);
    const sent = sentText(t.mind.requests[0]!);
    expect(sent).toContain('Claude Code: "fix the login test" (done)');
    expect(sent).toContain('All 12 tests pass now.');
  });

  it('sends the last lines it said, so it does not repeat them', async () => {
    const t = setup({ mind: ['One.', 'Two.', 'Three.', 'Four.', 'NOTHING'] });
    for (let i = 0; i < 5; i += 1) await t.checkIn.finished([finishedDone]);
    const sent = sentText(t.mind.requests[4]!);
    expect(sent).toContain('- "Two."\n- "Three."\n- "Four."');
    expect(sent).not.toContain('"One."');
  });
});

describe('CheckIn: failures are silence', () => {
  it('a window that cannot be read asks nothing, and says why in the log only', async () => {
    const t = setup();
    t.state.readFails = true;
    await t.checkIn.observeWindows([failing]);
    expect(t.mind.requests).toHaveLength(0);
    expect(t.logs.join('\n')).toContain('UIA timed out');
  });

  it('a memory store that throws still lets the mind be asked, without memories', async () => {
    const t = setup();
    t.state.closed = true;
    await t.checkIn.finished([finishedDone]);
    expect(t.mind.requests).toHaveLength(1);
    expect(sentText(t.mind.requests[0]!)).not.toContain('What you remember');
  });

  it('a store closed while the mind writes (a quit) is silence, never a throw', async () => {
    const t = setup({ mind: ['All green.'] });
    t.state.closed = true;
    await expect(t.checkIn.finished([finishedDone])).resolves.toBe(true);
    expect(t.remarks).toHaveLength(0);
    expect(t.logs.join('\n')).toContain('not open');
  });

  it('a mind that throws says why in the log only', async () => {
    const t = setup({ mind: [{ throws: new Error('offline') }] });
    await t.checkIn.finished([finishedDone]);
    expect(t.remarks).toHaveLength(0);
    expect(t.logs.join('\n')).toContain('offline');
  });
});

describe('CheckIn: silence', () => {
  it.each<MindStep>([
    'NOTHING',
    'nothing.',
    'word '.repeat(40),
    'Done 🎉',
    '',
    { reply: 'That port', stopReason: 'max_tokens' },
    { throws: new Error('offline') },
  ])('says and shows nothing for %j', async (step) => {
    const t = setup({ mind: [step] });
    await t.checkIn.observeWindows([failing]);
    await t.checkIn.finished([finishedDone]);
    expect(t.mind.requests).toHaveLength(2);
    expect(t.remarks).toHaveLength(0);
    expect(t.moods).toHaveLength(0);
  });

  it('a mind that hangs past fifteen seconds is silence', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup({ mind: ['hang'] });
    const pending = t.checkIn.finished([finishedDone]);
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    expect(t.remarks).toHaveLength(0);
  });
});

describe('CheckIn: delivery', () => {
  it('a line goes as pet.remark, with its offer when the mind names an enabled expert', async () => {
    const t = setup({
      experts: [claudeCode, writer],
      mind: ['That port is still taken.\nOFFER: Free port 3000\nEXPERT: claude-code'],
    });
    await t.checkIn.observeWindows([failing]);
    expect(t.remarks).toEqual([
      {
        remarkId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        petId: 'scout',
        text: 'That port is still taken.',
        offer: 'Free port 3000',
      },
    ]);
  });

  it('with no EXPERT, the offer goes to the only enabled expert', async () => {
    const t = setup({ mind: ['That port is taken.\nOFFER: Free port 3000'] });
    await t.checkIn.observeWindows([failing]);
    expect(t.remarks[0]?.offer).toBe('Free port 3000');
  });

  it.each([
    { experts: [claudeCode, writer], expert: '' },
    { experts: [claudeCode, writer], expert: '\nEXPERT: nobody' },
    { experts: [], expert: '\nEXPERT: claude-code' },
  ])(
    'drops the offer when no expert is clear ($experts.length on)',
    async ({ experts, expert }) => {
      const t = setup({ experts, mind: [`That port is taken.\nOFFER: Free port 3000${expert}`] });
      await t.checkIn.observeWindows([failing]);
      expect(t.remarks).toHaveLength(1);
      expect(t.remarks[0]?.offer).toBeUndefined();
      expect(await t.checkIn.accept(t.remarks[0]!.remarkId)).toBe(false);
    },
  );

  it('a finished hand-off gets a line tied to it, with no offer', async () => {
    const t = setup({ mind: ['All green.\nOFFER: Ship it\nMOOD: cheer'] });
    await t.checkIn.finished([finishedDone]);
    expect(t.remarks).toEqual([
      { remarkId: expect.any(String), petId: 'scout', text: 'All green.', handoffId: HANDOFF_ID },
    ]);
    expect(t.moods).toEqual(['cheer']);
  });

  it('a batch is one call and one plain line; the jobs in it are marked told', async () => {
    const t = setup({ mind: ['Three things are done. Which first?\nOFFER: Ship it'] });
    await t.checkIn.finished([job(1), finishedDone, job(2)]);
    expect(t.mind.requests).toHaveLength(1);
    const sent = sentText(t.mind.requests[0]!);
    expect(sent).toContain('Work finished: 3 things.');
    expect(sent).toContain('gist 1');
    expect(sent).toContain('gist 2');
    expect(t.remarks).toEqual([
      { remarkId: expect.any(String), petId: 'scout', text: 'Three things are done. Which first?' },
    ]);
    expect(t.reported).toEqual([['job-1', 'job-2']]);
  });

  it.each<MindStep>(['NOTHING', 'NOTHING\nMOOD: cheer', { throws: new Error('offline') }])(
    'silence about a batch marks nothing told (%j)',
    async (step) => {
      const t = setup({ mind: [step] });
      await t.checkIn.finished([job(1), job(2)]);
      expect(t.remarks).toHaveLength(0);
      expect(t.reported).toEqual([]);
    },
  );

  it('a mood alone is shown with no words', async () => {
    const t = setup({ mind: ['NOTHING\nMOOD: wince'] });
    await t.checkIn.finished([{ ...finishedDone, state: 'error', note: 'boom' }]);
    expect(t.remarks).toHaveLength(0);
    expect(t.moods).toEqual(['wince']);
  });

  it('a tired face only with nudges on; a break or switching them off clears it', async () => {
    const off = setup({
      settings: { wellbeing: { enabled: false } },
      mind: ['NOTHING\nMOOD: tired'],
    });
    await off.checkIn.finished([finishedDone]);
    expect(off.moods).toEqual([]);

    const t = setup({ mind: ['NOTHING\nMOOD: tired'] });
    await t.stretch();
    expect(t.moods).toEqual(['tired']);
    t.clock.t += MINUTE;
    await t.checkIn.observeActivity({ idleMs: BREAK_MS, windows: [editor] });
    expect(t.moods).toEqual(['tired', 'rested']);

    await t.checkIn.finished([finishedDone]);
    expect(t.moods).toEqual(['tired', 'rested', 'tired']);
    t.checkIn.settle();
    t.checkIn.settle();
    expect(t.moods).toEqual(['tired', 'rested', 'tired', 'rested']);
  });

  it('nudges switched off on the feed clears a tired face too', async () => {
    const t = setup({ mind: ['NOTHING\nMOOD: tired'] });
    await t.stretch();
    t.state.settings = Settings.parse({ wellbeing: { enabled: false } });
    await t.checkIn.observeActivity({ idleMs: 0, windows: [editor] });
    expect(t.moods).toEqual(['tired', 'rested']);
  });

  it('a late night is due after thirty minutes and says so', async () => {
    const t = setup();
    t.state.hour = 23;
    for (let i = 0; i <= 31; i += 1) {
      t.clock.t += MINUTE;
      await t.checkIn.observeActivity({ idleMs: 0, windows: [editor] });
    }
    expect(t.mind.requests).toHaveLength(1);
    expect(sentText(t.mind.requests[0]!)).toContain('It is late');
  });
});

describe('CheckIn: offers and accept', () => {
  it('an offer on a window reads it again on the click, never before, into the brief', async () => {
    const t = setup({ mind: ['That port is taken.\nOFFER: Free port 3000'] });
    await t.checkIn.observeWindows([editor]);
    await t.settle(failing);
    expect(t.reads).toEqual(['w-9']);
    expect(t.proposals).toHaveLength(0);
    t.state.text = `later text ${KEY}`;
    expect(await t.checkIn.accept(t.remarks[0]!.remarkId)).toBe(true);
    expect(t.reads).toEqual(['w-9', 'w-9']);
    expect(t.proposals).toEqual([
      {
        expertId: 'claude-code',
        petId: 'scout',
        brief: {
          ask: 'Free port 3000',
          context: {
            app: 'WindowsTerminal',
            windowTitle: 'npm test - failed - ai_pet',
            windowText: 'later text [hidden: API key]',
          },
        },
        projectHint: 'npm test - failed - ai_pet - parser.ts - ai_pet - Code',
      },
    ]);
    expect(await t.checkIn.accept(t.remarks[0]!.remarkId)).toBe(false);
  });

  it('a blocked read on the click sends the brief without text', async () => {
    const t = setup({ mind: ['That port is taken.\nOFFER: Free port 3000'] });
    await t.checkIn.observeWindows([failing]);
    t.state.blocked = true;
    expect(await t.checkIn.accept(t.remarks[0]!.remarkId)).toBe(true);
    expect(t.proposals[0]?.brief.context?.windowText).toBeUndefined();
  });

  it('a stretch offer reads nothing; its context has the front app, none for a blind one', async () => {
    const t = setup({ mind: ['Long one.\nOFFER: Write up where I am'] });
    await t.stretch();
    expect(await t.checkIn.accept(t.remarks[0]!.remarkId)).toBe(true);
    expect(t.reads).toHaveLength(0);
    expect(t.proposals[0]).toEqual({
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'Write up where I am', context: { app: 'Code', windowTitle: editor.title } },
    });

    const blindFront = setup({ mind: ['Long one.\nOFFER: Write up where I am'] });
    await blindFront.stretch([win('w-2', 'Vault', { processName: '1Password.exe' })]);
    await blindFront.checkIn.accept(blindFront.remarks[0]!.remarkId);
    expect(blindFront.proposals[0]?.brief).toEqual({ ask: 'Write up where I am' });
  });

  it('a wrong id, or the expert switched off since, proposes nothing', async () => {
    const t = setup({ mind: ['That port is taken.\nOFFER: Free port 3000'] });
    await t.checkIn.observeWindows([failing]);
    expect(await t.checkIn.accept('00000000-0000-4000-8000-00000000ffff')).toBe(false);
    expect(t.proposals).toHaveLength(0);
  });

  it('a new line replaces the last offer', async () => {
    const t = setup({ mind: ['That port is taken.\nOFFER: Free port 3000', 'All green.'] });
    await t.checkIn.observeWindows([failing]);
    await t.checkIn.finished([finishedDone]);
    expect(await t.checkIn.accept(t.remarks[0]!.remarkId)).toBe(false);
  });
});

describe('CheckIn: launch and back', () => {
  const facts: LaunchFacts = {
    crashed: false,
    lastVersion: '0.1.0',
    version: '0.1.0',
    releaseNotes: 'New in 0.1.0: translation.',
  };
  const ready: PickUpReady = {
    takenAt: 10 * 24 * 60 * MINUTE - 14 * 60 * MINUTE,
    items: [{ id: 'p1', kind: 'project', name: 'ai_pet', path: 'C:\\ai_pet', editor: 'vscode' }],
  };
  const iso = (t: number) => new Date(t).toISOString();

  it('a launch waits for "Say hello", and is not held by the cooldown or Not now', async () => {
    const off = setup({ settings: { greeting: false }, pickUp: ready });
    await off.checkIn.launch(facts);
    expect(off.mind.requests).toHaveLength(0);
    // The pick-up stays for the back check.
    expect(off.pickUp.takes).toBe(0);

    const t = setup({ mind: ['NOTHING', 'Morning.'] });
    t.checkIn.notNow();
    t.clock.t += NOT_NOW_MS;
    await t.checkIn.observeWindows([failing]);
    t.checkIn.notNow();
    await t.checkIn.launch(facts);
    expect(t.mind.requests).toHaveLength(2);
    expect(t.remarks.map((remark) => remark.text)).toEqual(['Morning.']);
  });

  it('a launch is stopped by the budget and by a call in front', async () => {
    const spent = setup({ spentOut: true, pickUp: ready });
    await spent.checkIn.launch(facts);
    const call = setup({
      hostWindows: [win('w-3', 'Meeting', { processName: 'Zoom.exe' })],
      pickUp: ready,
    });
    await call.checkIn.launch(facts);
    expect(spent.mind.requests).toHaveLength(0);
    expect(spent.pickUp.takes).toBe(0);
    expect(call.mind.requests).toHaveLength(0);
    // The pick-up stays for the back check, once the call is over.
    expect(call.pickUp.takes).toBe(0);
  });

  it('a launch starts the cooldown, so a window right after it waits', async () => {
    const t = setup();
    await t.checkIn.launch(facts);
    t.clock.t += MINUTE;
    await t.checkIn.observeWindows([failing]);
    expect(t.mind.requests).toHaveLength(1);
  });

  it('a launch reads the last open before the host overwrites it, and sends its facts', async () => {
    const opened = 10 * 24 * 60 * MINUTE - 20 * 60 * MINUTE;
    const t = setup({
      settings: { lastOpenedAt: iso(opened), lastClosedAt: iso(opened + 6 * 60 * MINUTE) },
      routines: ['Morning papers'],
      interrupted: 2,
    });
    const pending = t.checkIn.launch({ ...facts, crashed: true });
    // The host records this launch at once; the check-in already has the last one.
    t.state.settings = Settings.parse({ ...t.state.settings, lastOpenedAt: iso(t.clock.t) });
    await pending;
    expect(t.routinesSince).toEqual([iso(opened)]);
    const sent = sentText(t.mind.requests[0]!);
    expect(sent).toContain('Tagalong just opened.');
    expect(sent).toContain('They were away for 14 hours.');
    expect(sent).toContain('2 runs were cut short');
    expect(sent).toContain('Routines that ran since: Morning papers.');
    expect(sent).not.toContain('updated');
    expect(sent).toContain('They said: "Why is port 3000 taken?"');
  });

  it('an update is said with its release notes; a crash over it is the installer, not said', async () => {
    const t = setup({ interrupted: 1 });
    await t.checkIn.launch({ ...facts, crashed: true, lastVersion: '0.0.9' });
    const sent = sentText(t.mind.requests[0]!);
    expect(sent).toContain('Tagalong was updated from 0.0.9 to 0.1.0. New in 0.1.0: translation.');
    expect(sent).not.toContain('closed unexpectedly');
    // A first launch knows no last version: no update, and no routines without a last open.
    const first = setup();
    await first.checkIn.launch({ ...facts, lastVersion: null });
    expect(sentText(first.mind.requests[0]!)).not.toContain('updated');
    expect(first.routinesSince).toEqual([]);
  });

  it('the first hello after Welcome says so', async () => {
    const t = setup({ mind: ['Hi Sam.'] });
    await t.checkIn.launch({ ...facts, lastVersion: null, welcomed: true });
    expect(sentText(t.mind.requests[0]!)).toContain('They just finished setting Tagalong up');
    expect(t.remarks.map((remark) => remark.text)).toEqual(['Hi Sam.']);
  });

  it('a launch with a pick-up sends it, and its line rides with the Pick up card', async () => {
    const t = setup({ mind: ['Back to the parser?\nMOOD: cheer'], pickUp: ready });
    await t.checkIn.launch(facts);
    expect(sentText(t.mind.requests[0]!)).toContain('## Where they left off');
    expect(sentText(t.mind.requests[0]!)).toContain('- ai_pet');
    expect(t.pickUps).toEqual([{ text: 'Back to the parser?', items: ready.items }]);
    expect(t.remarks).toHaveLength(0);
    expect(t.moods).toEqual(['cheer']);
  });

  it('a silent launch spends the pick-up and shows nothing', async () => {
    const t = setup({ mind: ['NOTHING'], pickUp: ready });
    await t.checkIn.launch(facts);
    expect(t.pickUp.takes).toBe(1);
    expect(t.pickUp.ready).toBeNull();
    expect(t.pickUps).toHaveLength(0);
    expect(t.remarks).toHaveLength(0);
  });

  it('a launch with pick-up switched off takes none', async () => {
    const t = setup({ settings: { pickUp: false }, pickUp: ready });
    await t.checkIn.launch(facts);
    expect(t.pickUp.takes).toBe(0);
    expect(sentText(t.mind.requests[0]!)).not.toContain('Where they left off');
  });

  it('back: a ready pick-up wakes the mind once, and its line rides with the card', async () => {
    const t = setup({ mind: ['Welcome back.'], pickUp: ready });
    await t.checkIn.back();
    expect(t.mind.requests).toHaveLength(1);
    const sent = sentText(t.mind.requests[0]!);
    expect(sent).toMatch(/^## Why you woke\nThey are back after 14 hours\./);
    expect(t.pickUps).toEqual([{ text: 'Welcome back.', items: ready.items }]);
    // Taken: the next back finds nothing to ask about.
    t.clock.t += COOLDOWN_MS;
    await t.checkIn.back();
    expect(t.mind.requests).toHaveLength(1);
  });

  it('back waits for its switch, the cooldown and Not now, and leaves the pick-up for later', async () => {
    const off = setup({ settings: { pickUp: false }, pickUp: ready });
    await off.checkIn.back();
    expect(off.pickUp.takes).toBe(0);

    const t = setup({ pickUp: ready });
    await t.checkIn.observeWindows([failing]);
    await t.checkIn.back();
    expect(t.mind.requests).toHaveLength(1);
    expect(t.pickUp.takes).toBe(0);
    t.clock.t += COOLDOWN_MS;
    t.checkIn.notNow();
    await t.checkIn.back();
    expect(t.pickUp.takes).toBe(0);
    t.clock.t += NOT_NOW_MS;
    await t.checkIn.back();
    expect(t.pickUp.takes).toBe(1);
    expect(t.mind.requests).toHaveLength(2);
  });

  it('a source that throws is silence, never a throw', async () => {
    const t = setup({ pickUp: ready });
    t.state.closed = true;
    await expect(t.checkIn.launch(facts)).resolves.toBeUndefined();
    expect(t.pickUps).toHaveLength(0);
  });
});
