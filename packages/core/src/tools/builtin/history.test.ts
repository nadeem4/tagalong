/** Tests for the search_history tool: the hits it lists, input checks and store failures. */
import { describe, expect, it } from 'vitest';
import { hostToCoreMethods, type ActivityEntry, type SightLogEntry } from '@tagalong/protocol';
import type { HistoryHit, HistorySearchParams } from '../../memory/history-search';
import { EXTENSION_METHODS } from '../../server/ws-server';
import { fakeTurnTools } from '../fake-turn';
import { directivesIn } from '../test-support';
import { SEARCH_HISTORY, type HistoryToolDeps } from './history';

/** Local times, so a bare date's midnight follows the machine's, as the tool's does. */
const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString();
const NOW = new Date(2026, 9, 16, 17, 0);

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
  hits?: HistoryHit[];
  sights?: SightLogEntry[];
  rows?: ActivityEntry[];
}

/** Fakes that keep the stores' contracts: range-bounded, sight newest first, activity oldest first. */
function deps(
  world: World | HistoryHit[] = {},
): HistoryToolDeps & { asked: HistorySearchParams[]; ranges: string[] } {
  const w: World = Array.isArray(world) ? { hits: world } : world;
  const asked: HistorySearchParams[] = [];
  const ranges: string[] = [];
  return {
    asked,
    ranges,
    history: {
      search: (params) => {
        asked.push(params);
        return w.hits ?? [];
      },
    },
    sightLog: {
      list: (limit = 200, since = '', until = '9999') => {
        ranges.push(`sight ${since} ${until}`);
        return (w.sights ?? [])
          .filter((row) => row.at >= since && row.at < until)
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, limit);
      },
    },
    activity: {
      since: (start, limit = 200, until = '9999') => {
        ranges.push(`activity ${start} ${until}`);
        return (w.rows ?? [])
          .filter((row) => row.startedAt >= start && row.startedAt < until)
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
          .slice(0, limit);
      },
    },
    days: () => 30,
    now: () => NOW,
  };
}

async function run(wired: HistoryToolDeps, input: unknown) {
  return fakeTurnTools({ history: wired }).run({ name: SEARCH_HISTORY, input });
}

describe('search_history', () => {
  it('lists the hits with day, time, app and kind, and says it only knows titles', async () => {
    const wired = deps([
      {
        at: new Date(2026, 9, 13, 14, 5).toISOString(),
        kind: 'saw',
        app: 'chrome.exe',
        text: 'Vector databases explained',
      },
      { at: new Date(2026, 9, 13, 9, 0).toISOString(), kind: 'asked', text: 'what is qdrant?' },
      { at: new Date(2026, 9, 12, 9, 0).toISOString(), kind: 'saw', app: '1password.exe' },
    ]);
    const outcome = await run(wired, { query: 'vector databases' });
    expect(outcome.isError).toBeUndefined();
    const text = String(outcome.content);
    expect(text).toContain('Tue 13 Oct 14:05 saw in chrome.exe: "Vector databases explained"');
    expect(text).toContain('Tue 13 Oct 09:00 asked: "what is qdrant?"');
    expect(text).toContain('Mon 12 Oct 09:00 saw in 1password.exe (no title kept)');
    // The description says once that only titles and asks are kept; the result does not repeat it.
    expect(text).not.toMatch(/no page text/);
    expect(wired.asked).toEqual([{ query: 'vector databases', excludeTurnId: 'turn-1' }]);
  });

  it('keeps hits before until, when one is given', async () => {
    const wired = deps([
      { at: local(14, 10), kind: 'asked', text: 'later' },
      { at: local(13, 10), kind: 'asked', text: 'earlier' },
    ]);
    const outcome = await run(wired, { query: 'x', until: '2026-10-14' });
    expect(String(outcome.content)).toContain('earlier');
    expect(String(outcome.content)).not.toContain('later');
  });

  describe('without a query', () => {
    const world: World = {
      sights: [
        sight(local(16, 9, 0), { app: 'Code', title: 'runner.ts' }),
        sight(local(16, 9, 30), { app: 'Code', title: 'runner.ts' }),
        sight(local(16, 11, 40), { app: 'Code', title: 'runner.ts' }),
        sight(local(16, 10, 0), { app: '1Password.exe' }),
        sight(local(16, 10, 5), { kind: 'sent_to_ai', app: 'Code', title: 'runner.ts' }),
        sight(local(15, 22, 0), { app: 'chrome.exe', title: 'Yesterday' }),
      ],
      rows: [
        activity(local(16, 9, 10), {
          turnId: 'turn-0',
          text: 'my key is sk-ant-api03-abcdefghijklmnop',
        }),
        activity(local(16, 9, 20), { turnId: 'turn-1', text: 'what did we do today?' }),
        activity(local(16, 10, 30), {
          kind: 'expert',
          expertName: 'Claude Code',
          text: 'Fix the login test\n\nSelection: secret stuff',
          state: 'error',
          changedFiles: ['a.ts', 'b.ts'],
        }),
        activity(local(16, 8, 0), { kind: 'routine', text: 'Morning papers' }),
        activity(local(16, 12, 0), {
          kind: 'connector',
          app: 'GitHub',
          tool: 'create_issue',
          access: 'write',
        }),
      ],
    };

    it('lists the day so far by default, newest first, as plain rows', async () => {
      const wired = deps(world);
      const outcome = await run(wired, {});
      expect(outcome.isError).toBeUndefined();
      const lines = String(outcome.content).split('\n');
      expect(lines).toEqual([
        'Fri 16 Oct 12:00 app GitHub create_issue (write)',
        'Fri 16 Oct 09:00-11:40 saw in Code: "runner.ts" (3 looks)',
        'Fri 16 Oct 10:30 expert Claude Code: "Fix the login test" (error, 2 files changed)',
        'Fri 16 Oct 10:00 saw in 1Password.exe (no title kept, 1 look)',
        expect.stringMatching(/^Fri 16 Oct 09:10 asked: "my key is \[hidden: /),
        'Fri 16 Oct 08:00 routine: "Morning papers" (done)',
      ]);
      expect(directivesIn(outcome.content)).toEqual([]);
      // From local midnight today to now, and never this turn's own question.
      const midnight = new Date(2026, 9, 16).toISOString();
      expect(wired.ranges).toContain(`activity ${midnight} ${NOW.toISOString()}`);
      expect(wired.ranges).toContain(`sight ${midnight} ${NOW.toISOString()}`);
      expect(String(outcome.content)).not.toContain('sk-ant-api03');
      expect(String(outcome.content)).not.toContain('what did we do today');
      expect(String(outcome.content)).not.toContain('secret stuff');
      expect(wired.asked).toEqual([]);
    });

    it('takes a since and until range', async () => {
      const wired = deps(world);
      const outcome = await run(wired, { since: '2026-10-15', until: '2026-10-16' });
      expect(String(outcome.content)).toBe(
        'Thu 15 Oct 22:00 saw in chrome.exe: "Yesterday" (1 look)',
      );
      expect(wired.ranges).toContain(
        `sight ${new Date(2026, 9, 15).toISOString()} ${new Date(2026, 9, 16).toISOString()}`,
      );
    });

    it('never reaches further back than the privacy log keeps', async () => {
      const wired = { ...deps(world), days: () => 7 };
      const outcome = await run(wired, { since: '2026-09-01' });
      expect(outcome.isError).toBeUndefined();
      const cutoff = new Date(NOW.getTime() - 7 * 86_400_000).toISOString();
      expect(wired.ranges).toEqual([
        `activity ${cutoff} ${NOW.toISOString()}`,
        `sight ${cutoff} ${NOW.toISOString()}`,
      ]);
      // A range wholly older than the log keeps lists nothing.
      const old = await run(wired, { since: '2026-09-01', until: '2026-09-02' });
      expect(String(old.content)).toMatch(/^Nothing on record/);
    });

    it('stops at 60 rows', async () => {
      const sights = Array.from({ length: 80 }, (_, n) =>
        sight(local(16, 9 + Math.floor(n / 60), n % 60), { app: `App${n}` }),
      );
      const outcome = await run(deps({ sights }), {});
      expect(String(outcome.content).split('\n')).toHaveLength(61);
      expect(String(outcome.content)).toMatch(/and 20 more\.$/);
    });

    it('says plainly when nothing is on record in the range', async () => {
      const outcome = await run(deps(), { since: '2026-10-01', until: '2026-10-02' });
      expect(outcome.isError).toBeUndefined();
      expect(String(outcome.content)).toMatch(/^Nothing on record/);
    });

    it('answers isError when a store fails', async () => {
      const wired = deps(world);
      wired.activity.since = () => {
        throw new Error('SQLITE_CORRUPT');
      };
      const outcome = await run(wired, {});
      expect(outcome.isError).toBe(true);
      expect(String(outcome.content)).not.toContain('SQLITE');
    });
  });

  it('passes since on, a bare date as local midnight', async () => {
    const wired = deps();
    await run(wired, { query: 'vector', since: '2026-10-13' });
    expect(wired.asked[0]?.since).toBe(new Date(2026, 9, 13).toISOString());
    await run(wired, { query: 'vector', since: '2026-10-13T10:00:00.000Z' });
    expect(wired.asked[1]?.since).toBe('2026-10-13T10:00:00.000Z');
  });

  it('says plainly when nothing matched', async () => {
    const outcome = await run(deps(), { query: 'vector' });
    expect(outcome.isError).toBeUndefined();
    expect(String(outcome.content)).toMatch(/Nothing/);
  });

  it('answers bad input with isError, never a throw', async () => {
    for (const input of [
      { query: '' },
      { query: 3 },
      null,
      { query: 'x', since: 'soon' },
      { until: 'later' },
    ]) {
      const outcome = await run(deps(), input);
      expect(outcome.isError).toBe(true);
    }
  });

  it('answers isError when the store fails', async () => {
    const wired = deps();
    wired.history.search = () => {
      throw new Error('SQLITE_CORRUPT');
    };
    const outcome = await run(wired, { query: 'vector' });
    expect(outcome.isError).toBe(true);
    expect(String(outcome.content)).not.toContain('SQLITE');
  });

  it('is a read tool, and the extension has no way to call it', () => {
    const tools = fakeTurnTools({ history: deps() });
    expect(tools.tools.find((tool) => tool.id === SEARCH_HISTORY)?.kind).toBe('read');
    // No protocol method reaches the index: only Scout's own turns, through this tool.
    expect(Object.keys(hostToCoreMethods).some((name) => /history/i.test(name))).toBe(false);
    expect([...EXTENSION_METHODS].sort()).toEqual(['ask', 'interrupt', 'pets.list']);
  });
});
