/**
 * Tests for the browser_search tool, driven by a fake SearchApi and fake permission needs.
 * Covers each source's call and permission, limits, dates, formatting and failure sentences.
 */
import { ErrorCode, RpcError } from '@tagalong/contract';
import { describe, expect, it, vi } from 'vitest';
import type { SearchApi, SearchHit } from '../layer/api';
import type { Need } from '../permissions';
import { browserSearchTool } from './browser-search';
import type { Needs } from './tabs';

function setup(
  hits: SearchHit[] = [{ title: 'Doc', url: 'https://a.test/x', when: '2026-10-29' }],
) {
  const calls: Need[] = [];
  const fn = () => vi.fn(async (..._args: unknown[]) => hits);
  const search = {
    history: fn(),
    bookmarks: fn(),
    readingList: fn(),
    downloads: fn(),
    closedTabs: fn(),
  };
  const needs: Needs = {
    ensure: async (need) => {
      calls.push(need);
    },
  };
  const t = browserSearchTool({
    search: search as unknown as SearchApi,
    needs,
    bodyName: 'Chrome',
  });
  return { t, calls, search };
}

const rejection = (p: Promise<unknown>): Promise<RpcError> =>
  p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e as RpcError,
  );

describe('browser_search tool', () => {
  it('is a read tool named browser_search', () => {
    const { t } = setup();
    expect(t.tool.name).toBe('browser_search');
    expect(t.tool.effect).toBe('read');
    expect(t.tool.description.endsWith('This is the Chrome browser.')).toBe(true);
  });

  it('each_source_calls_its_api_with_text_dates_and_limit', async () => {
    const { t, search } = setup();
    const since = '2026-10-01';
    const until = '2026-10-29';
    const s = Date.parse(since);
    const u = Date.parse(until);
    await t.run({ source: 'history', text: 'cats', since, until, limit: 5 });
    expect(search.history).toHaveBeenCalledWith('cats', s, u, 5);
    await t.run({ source: 'bookmarks', text: 'cats', limit: 5 });
    expect(search.bookmarks).toHaveBeenCalledWith('cats', 5);
    await t.run({ source: 'reading_list', text: 'cats', limit: 5 });
    expect(search.readingList).toHaveBeenCalledWith('cats', 5);
    await t.run({ source: 'downloads', text: 'cats', since, until, limit: 5 });
    expect(search.downloads).toHaveBeenCalledWith('cats', s, u, 5);
    await t.run({ source: 'closed', limit: 5 });
    expect(search.closedTabs).toHaveBeenCalledWith(5);
  });

  it('each_source_asks_for_its_own_permission_first', async () => {
    const want: Record<string, string> = {
      history: 'history',
      bookmarks: 'bookmarks',
      reading_list: 'readingList',
      downloads: 'downloads',
      closed: 'sessions',
    };
    for (const [source, name] of Object.entries(want)) {
      const { t, calls } = setup();
      await t.run({ source });
      expect(calls).toEqual([{ kind: 'permission', name }]);
    }
  });

  it('limit_defaults_to_20_and_is_capped_at_50', async () => {
    const { t, search } = setup();
    await t.run({ source: 'history' });
    expect(search.history).toHaveBeenLastCalledWith('', undefined, undefined, 20);
    await t.run({ source: 'history', limit: 500 });
    expect(search.history).toHaveBeenLastCalledWith('', undefined, undefined, 50);
    await t.run({ source: 'closed', limit: 500 });
    expect(search.closedTabs).toHaveBeenLastCalledWith(50);
  });

  it('since_and_until_parse_iso_dates_to_milliseconds', async () => {
    const { t, search } = setup();
    await t.run({
      source: 'history',
      since: '2026-10-29T10:00:00Z',
      until: '2026-10-29T11:00:00Z',
    });
    expect(search.history).toHaveBeenCalledWith(
      '',
      Date.UTC(2026, 9, 29, 10),
      Date.UTC(2026, 9, 29, 11),
      20,
    );
  });

  it('a_bad_date_is_invalid_params', async () => {
    const { t, search } = setup();
    const e = await rejection(t.run({ source: 'history', since: 'last tuesday-ish' }));
    expect(e.code).toBe(ErrorCode.invalid_params);
    expect(search.history).not.toHaveBeenCalled();
  });

  it('unknown_source_is_invalid_params', async () => {
    const { t } = setup();
    const e = await rejection(t.run({ source: 'cookies' }));
    expect(e.code).toBe(ErrorCode.invalid_params);
  });

  it('no_hits_say_nothing_matched', async () => {
    const { t } = setup([]);
    expect(await t.run({ source: 'history', text: 'zzz' })).toEqual([
      { type: 'text', text: 'Nothing matched.' },
    ]);
  });

  it('formats_one_hit_per_line', async () => {
    const { t } = setup([
      { title: 'Doc', url: 'https://a.test/x', when: '2026-10-29' },
      { title: 'Bare', url: 'https://b.test' },
    ]);
    expect(await t.run({ source: 'bookmarks' })).toEqual([
      { type: 'text', text: '2026-10-29 | Doc | https://a.test/x\nBare | https://b.test' },
    ]);
  });

  it('hit_lines_are_capped_so_one_search_stays_small', async () => {
    const { t } = setup([{ title: 'x'.repeat(1000), url: 'https://a.test' }]);
    const out = await t.run({ source: 'history' });
    const text = (out[0] as { text: string }).text;
    expect(text.length).toBe(300);
  });

  it('reading_list_unsupported_is_tool_failed_not_supported_in_this_browser', async () => {
    const { t, search } = setup();
    search.readingList.mockRejectedValueOnce(new Error('not supported in this browser'));
    const e = await rejection(t.run({ source: 'reading_list' }));
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toContain('not supported in this browser');
  });

  it('a_denied_permission_surfaces_its_sentence', async () => {
    const search = setup().search as unknown as SearchApi;
    const needs: Needs = {
      ensure: async () => {
        throw new RpcError(ErrorCode.tool_failed, 'You did not allow search browsing history.');
      },
    };
    const t = browserSearchTool({ search, needs, bodyName: 'Chrome' });
    const e = await rejection(t.run({ source: 'history' }));
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toBe('You did not allow search browsing history.');
  });
});
