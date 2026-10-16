/** Tests for the recall_day tool and estimateSpan: day bounds, grouping, what is left out. */
import { afterEach, describe, expect, it } from 'vitest';
import type { ActivityEntry, SightLogEntry } from '@tagalong/protocol';
import type { PickUpSnapshot } from '../../pick-up/store';
import { fakeTurnTools } from '../fake-turn';
import { DAY_CHARS, RECALL_DAY, estimateSpan, type DayToolDeps } from './day';

/** Local times, so the day's bounds follow the machine's midnight as the tool's do. */
const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString();
const NOW = new Date(2026, 9, 15, 17, 0);

let rowId = 0;
function sight(at: string, fields: Partial<SightLogEntry> = {}): SightLogEntry {
  rowId += 1;
  return { id: `s${rowId}`, kind: 'read_text', at, ...fields };
}

function activity(startedAt: string, fields: Partial<ActivityEntry>): ActivityEntry {
  rowId += 1;
  return {
    id: `a${rowId}`,
    kind: 'turn',
    state: 'done',
    petId: 'scout',
    startedAt,
    ...fields,
  } as ActivityEntry;
}

interface World {
  sights?: SightLogEntry[];
  rows?: ActivityEntry[];
  pending?: { expertId: string; expertName: string; ask: string }[];
  snapshot?: PickUpSnapshot | null;
  pickUpOff?: boolean;
  now?: Date;
}

/** Fakes that keep the stores' contracts: since-bounded, sight newest first, activity oldest first. */
function deps(world: World = {}): DayToolDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    sightLog: {
      list: (limit = 200, since = '', until = '9999') => {
        asked.push(`sight ${since}`, `sight until ${until}`);
        return (world.sights ?? [])
          .filter((row) => row.at >= since && row.at < until)
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, limit);
      },
    },
    activity: {
      since: (start, limit = 200, until = '9999') => {
        asked.push(`activity ${start}`, `activity until ${until}`);
        return (world.rows ?? [])
          .filter((row) => row.startedAt >= start && row.startedAt < until)
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
          .slice(0, limit);
      },
    },
    handoffs: { pending: () => world.pending ?? [] },
    ...(world.pickUpOff === true ? {} : { pickUp: { get: () => world.snapshot ?? null } }),
    now: () => world.now ?? NOW,
  };
}

async function recall(world: World, input: unknown = {}) {
  const wired = deps(world);
  const outcome = await fakeTurnTools({ day: wired }).run({ name: RECALL_DAY, input });
  return { ...outcome, asked: wired.asked };
}

describe(RECALL_DAY, () => {
  it('groups no more than a dozen windows, then counts the rest', async () => {
    const sights = Array.from({ length: 15 }, (_, n) => sight(local(15, 9, n), { app: `A${n}` }));
    const outcome = await recall({ sights });
    expect(outcome.content).toContain('and 3 more');
  });

  it('is a read tool', () => {
    const tool = fakeTurnTools({ day: deps() }).tools.find((t) => t.id === RECALL_DAY);
    expect(tool?.kind).toBe('read');
  });

  it('leaves out everything before local midnight', async () => {
    const outcome = await recall({
      sights: [
        sight(local(14, 23, 30), { app: 'Old.exe', title: 'last night' }),
        sight(local(15, 9), { app: 'Code.exe', title: 'ai_pet' }),
      ],
      rows: [
        activity(local(14, 22), { text: 'a question from yesterday' }),
        activity(local(15, 10), { text: 'what is this error?' }),
      ],
    });

    expect(outcome.isError).toBeUndefined();
    expect(outcome.content).toContain('Code.exe: ai_pet');
    expect(outcome.content).toContain('what is this error?');
    expect(outcome.content).not.toContain('Old.exe');
    expect(outcome.content).not.toContain('from yesterday');
    expect(outcome.asked).toContain(`sight ${local(15, 0)}`);
  });

  it('gives yesterday from its midnight to today’s, nothing after', async () => {
    const outcome = await recall(
      {
        sights: [
          sight(local(13, 23), { app: 'Before.exe' }),
          sight(local(14, 9), { app: 'Code.exe', title: 'ai_pet' }),
          sight(local(14, 12), { app: 'Code.exe', title: 'ai_pet' }),
          sight(local(15, 9), { app: 'Today.exe' }),
        ],
        rows: [
          activity(local(14, 11), { text: 'yesterday’s question' }),
          activity(local(15, 10), { text: 'today’s question' }),
        ],
      },
      { day: 'yesterday' },
    );

    expect(outcome.content).toMatch(/^Yesterday/);
    expect(outcome.content).toContain('Code.exe: ai_pet (2 looks)');
    expect(outcome.content).toContain('yesterday’s question');
    expect(outcome.content).not.toContain('today’s question');
    expect(outcome.content).not.toContain('Today.exe');
    expect(outcome.content).not.toContain('Before.exe');
    expect(outcome.content).toContain('about 3 hours');
  });

  it('groups looks by app and title, most first, and estimates the span', async () => {
    const outcome = await recall({
      sights: [
        sight(local(15, 9), { app: 'Code.exe', title: 'ai_pet' }),
        sight(local(15, 11), { app: 'Notion.exe', title: 'Plans' }),
        sight(local(15, 13), { app: 'Code.exe', title: 'ai_pet' }),
        sight(local(15, 14, 30), { app: 'Code.exe', title: 'ai_pet' }),
        // A blind spot keeps its app only.
        sight(local(15, 15), { app: '1Password.exe' }),
        // A send has no app: it counts for the span, not the list.
        sight(local(15, 15, 10), { kind: 'sent_to_ai', providerId: 'anthropic' }),
      ],
    });

    const content = outcome.content as string;
    expect(content).toContain('about 6 hours');
    expect(content).toContain('an estimate');
    expect(content.indexOf('Code.exe: ai_pet (3 looks)')).toBeLessThan(
      content.indexOf('Notion.exe: Plans (1 look)'),
    );
    expect(content).toContain('1Password.exe (1 look)');
    expect(content).toContain('only knows what it looked at');
  });

  it('says plainly when nothing is on record', async () => {
    const outcome = await recall({});
    expect(outcome.isError).toBeUndefined();
    expect(outcome.content).toContain('Nothing on record for today');
  });

  it('lists what experts did with their brief, state and files, never the answer', async () => {
    const outcome = await recall({
      rows: [
        activity(local(15, 10), {
          kind: 'expert',
          expertName: 'Claude Code',
          text: 'Fix the e2e tests\n\nSelected text: SECRET-SELECTION',
          answer: 'SECRET-ANSWER: I changed four files',
          changedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
        }),
        activity(local(15, 11), {
          kind: 'expert',
          state: 'stopped',
          expertName: 'Claude Code',
          text: 'Add retry',
        }),
        activity(local(15, 12), {
          kind: 'routine',
          text: 'Morning papers',
          answer: 'SECRET-ROUTINE-ANSWER',
        }),
        activity(local(15, 13), {
          kind: 'connector',
          app: 'notion',
          tool: 'search',
          access: 'read',
        }),
        activity(local(15, 14), { text: 'ask', answer: 'SECRET-TURN-ANSWER' }),
      ],
    });

    const content = outcome.content as string;
    expect(content).toContain('Claude Code: "Fix the e2e tests" (done, 4 files changed)');
    expect(content).toContain('Claude Code: "Add retry" (stopped)');
    expect(content).toContain('Morning papers (done)');
    expect(content).toContain('notion search (read)');
    expect(content).toContain('Stopped or failed: Claude Code "Add retry"');
    expect(content).not.toContain('SECRET');
  });

  it('leaves out the question that asked for this briefing', async () => {
    const outcome = await recall({
      rows: [
        activity(local(15, 9), { text: 'earlier question', turnId: 'turn-0' }),
        activity(local(15, 16), { text: 'What did we do today?', turnId: 'turn-1' }),
      ],
    });
    expect(outcome.content).toContain('earlier question');
    expect(outcome.content).not.toContain('What did we do today?');
  });

  it('clips a long question to 120 characters', async () => {
    const outcome = await recall({ rows: [activity(local(15, 9), { text: 'x'.repeat(300) })] });
    expect(outcome.content).toContain(`${'x'.repeat(119)}…`);
    expect(outcome.content).not.toContain('x'.repeat(120));
  });

  it('names the projects pick-up saw and the briefs waiting for Send', async () => {
    const outcome = await recall({
      sights: [sight(local(15, 9), { app: 'Code.exe' })],
      snapshot: {
        startedAt: 0,
        takenAt: 0,
        projects: [{ name: 'ai_pet', path: 'C:\\ai_pet', editor: 'vscode', branch: 'feat/x' }],
        handoffs: [],
      },
      pending: [{ expertId: 'cc', expertName: 'Claude Code', ask: 'add retry' }],
    });
    expect(outcome.content).toContain('ai_pet on feat/x');
    expect(outcome.content).toContain('Waiting for Send: Claude Code "add retry"');
  });

  it('with pick-up off, still lists the briefs waiting for Send', async () => {
    const outcome = await recall({
      pickUpOff: true,
      pending: [{ expertId: 'cc', expertName: 'Claude Code', ask: 'add retry' }],
    });
    expect(outcome.content).toContain('Waiting for Send: Claude Code "add retry"');
  });

  it('keeps the answer under the cap', async () => {
    const rows = Array.from({ length: 200 }, (_, n) =>
      activity(local(15, 9, n % 60), { text: `question ${n} ${'y'.repeat(100)}` }),
    );
    const outcome = await recall({ rows });
    expect((outcome.content as string).length).toBeLessThanOrEqual(DAY_CHARS);
    expect(outcome.content).toMatch(/cut short/);
  });

  it('refuses a day it does not know', async () => {
    for (const input of [{ day: 'last week' }, 'today', { day: 3 }]) {
      const outcome = await recall({}, input);
      expect(outcome.isError).toBe(true);
      expect(outcome.content).toContain("'today' or 'yesterday'");
    }
  });

  it('answers a store that fails with an error the model can repeat, never a throw', async () => {
    const wired = deps();
    wired.sightLog.list = () => {
      throw new Error('database is locked');
    };
    const outcome = await fakeTurnTools({ day: wired }).run({ name: RECALL_DAY, input: {} });
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain('could not read');
  });
});

describe(`${RECALL_DAY}, review fixes`, () => {
  it('reads yesterday bounded in the query, so a busy today cannot crowd it out', async () => {
    const busy = Array.from({ length: 1_200 }, (_, n) =>
      sight(new Date(2026, 9, 15, 8, 0, n).toISOString(), { app: 'Today.exe' }),
    );
    const outcome = await recall(
      {
        sights: [
          ...busy,
          sight(local(14, 9), { app: 'Code.exe', title: 'ai_pet' }),
          sight(local(14, 12), { app: 'Code.exe', title: 'ai_pet' }),
        ],
      },
      { day: 'yesterday' },
    );
    expect(outcome.content).toContain('Code.exe: ai_pet (2 looks)');
    expect(outcome.content).toContain('about 3 hours');
    expect(outcome.asked).toContain(`sight until ${local(15, 0)}`);
    expect(outcome.asked).toContain(`activity until ${local(15, 0)}`);
  });

  it('bounds today at the next midnight too', async () => {
    const outcome = await recall({
      sights: [sight(local(16, 1), { app: 'Skewed.exe' }), sight(local(15, 9), { app: 'A.exe' })],
    });
    expect(outcome.content).not.toContain('Skewed.exe');
    expect(outcome.asked).toContain(`sight until ${local(16, 0)}`);
  });

  it('just after midnight, today is the new day and yesterday the one before', async () => {
    const now = new Date(2026, 9, 15, 0, 5);
    const today = await recall({ now });
    expect(today.asked).toEqual(
      expect.arrayContaining([`sight ${local(15, 0)}`, `sight until ${local(16, 0)}`]),
    );
    const yesterday = await recall({ now }, { day: 'yesterday' });
    expect(yesterday.asked).toEqual(
      expect.arrayContaining([`sight ${local(14, 0)}`, `sight until ${local(15, 0)}`]),
    );
  });

  describe('across a clock change, in the person’s time zone', () => {
    const saved = process.env.TZ;
    afterEach(() => {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    });

    it('gives a 25-hour yesterday when the clocks went back', async () => {
      process.env.TZ = 'Europe/London';
      // 25 October 2026: BST ends at 02:00, so the day runs 23:00Z to 00:00Z next day.
      const outcome = await recall(
        { now: new Date('2026-10-26T10:00:00.000Z') },
        { day: 'yesterday' },
      );
      expect(outcome.asked).toEqual(
        expect.arrayContaining([
          'sight 2026-10-24T23:00:00.000Z',
          'sight until 2026-10-26T00:00:00.000Z',
        ]),
      );
    });

    it('gives a 23-hour yesterday when the clocks went forward', async () => {
      process.env.TZ = 'Europe/London';
      // 29 March 2026: BST starts at 01:00, so the day runs 00:00Z to 23:00Z.
      const outcome = await recall(
        { now: new Date('2026-03-30T10:00:00.000Z') },
        { day: 'yesterday' },
      );
      expect(outcome.asked).toEqual(
        expect.arrayContaining([
          'sight 2026-03-29T00:00:00.000Z',
          'sight until 2026-03-29T23:00:00.000Z',
        ]),
      );
    });
  });

  it('hides secrets in the questions, briefs and routine names it quotes', async () => {
    const key = `sk-${'a'.repeat(30)}`;
    const token = `ghp_${'b'.repeat(36)}`;
    const outcome = await recall({
      rows: [
        activity(local(15, 9), { text: `why does ${key} fail?` }),
        activity(local(15, 10), { kind: 'routine', text: `Check ${token}` }),
        activity(local(15, 11), { kind: 'expert', expertName: 'X', text: `use ${key}` }),
      ],
      pending: [{ expertId: 'cc', expertName: 'Claude Code', ask: `rotate ${token}` }],
    });
    const content = outcome.content as string;
    expect(content).not.toContain(key);
    expect(content).not.toContain(token);
    expect(content).toContain('[hidden: API key]');
    expect(content).toContain('[hidden: access token]');
  });
});

describe('estimateSpan', () => {
  it('is null with fewer than two times, and rounds to the half hour', () => {
    expect(estimateSpan([])).toBeNull();
    expect(estimateSpan([local(15, 9)])).toBeNull();
    expect(estimateSpan([local(15, 9), local(15, 9, 20)])).toBe('about 20 minutes');
    expect(estimateSpan([local(15, 15, 40), local(15, 9)])).toBe('about 6.5 hours');
    expect(estimateSpan([local(15, 9), local(15, 10)])).toBe('about 1 hour');
  });
});
