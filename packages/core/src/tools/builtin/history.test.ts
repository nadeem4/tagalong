/** Tests for the search_history tool: the hits it lists, input checks and store failures. */
import { describe, expect, it } from 'vitest';
import { hostToCoreMethods } from '@tagalong/protocol';
import type { HistoryHit, HistorySearchParams } from '../../memory/history-search';
import { EXTENSION_METHODS } from '../../server/ws-server';
import { fakeTurnTools } from '../fake-turn';
import { SEARCH_HISTORY, type HistoryToolDeps } from './history';

function deps(hits: HistoryHit[] = []): HistoryToolDeps & { asked: HistorySearchParams[] } {
  const asked: HistorySearchParams[] = [];
  return {
    asked,
    history: {
      search: (params) => {
        asked.push(params);
        return hits;
      },
    },
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
    expect(text).toMatch(/titles/);
    expect(wired.asked).toEqual([{ query: 'vector databases', excludeTurnId: 'turn-1' }]);
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
    for (const input of [{}, { query: '' }, { query: 3 }, null, { query: 'x', since: 'soon' }]) {
      const outcome = await run(deps(), input);
      expect(outcome.isError).toBe(true);
    }
  });

  it('answers isError when the store fails', async () => {
    const outcome = await run(
      {
        history: {
          search: () => {
            throw new Error('SQLITE_CORRUPT');
          },
        },
      },
      { query: 'vector' },
    );
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
