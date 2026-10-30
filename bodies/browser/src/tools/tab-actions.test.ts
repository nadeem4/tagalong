/**
 * Tests for the tab_actions tool, driven by fake ActionsApi, TabsApi and permission needs.
 * Pins the address rule (http and https only), which permission each action asks for, the
 * declared effect, and the plain sentences a refusal or failure carries.
 */
import { ErrorCode, RpcError } from '@tagalong/contract';
import { describe, expect, it, vi } from 'vitest';
import type { ActionsApi, TabInfo, TabsApi } from '../layer/api';
import type { Need } from '../permissions';
import { tabActionsTool } from './tab-actions';
import type { Needs } from './tabs';

const ACTIVE: TabInfo = {
  id: 7,
  windowId: 1,
  title: 'Active page',
  url: 'https://a.test/x',
  active: true,
  discarded: false,
};

function setup(activeTab: TabInfo | null = ACTIVE, ensure?: Needs['ensure']) {
  const asked: Need[] = [];
  const actions = {
    open: vi.fn(async (_url: string) => ({ id: 11 })),
    search: vi.fn(async (_text: string) => ({ id: 12 })),
    close: vi.fn(async (_id: number) => undefined),
    switchTo: vi.fn(async (_id: number) => undefined),
    group: vi.fn(async (_ids: number[], _title?: string) => undefined),
    reopen: vi.fn(async (): Promise<{ title: string; url: string } | null> => ({
      title: 'Back',
      url: 'https://b.test/',
    })),
    bookmark: vi.fn(async (_title: string, _url: string) => undefined),
    addToReadingList: vi.fn(async (_title: string, _url: string) => undefined),
  };
  const needs: Needs = {
    ensure:
      ensure ??
      (async (need) => {
        asked.push(need);
      }),
  };
  const tabs: TabsApi = {
    list: async () => [],
    get: async () => null,
    activeInFocusedWindow: async () => activeTab,
  };
  const t = tabActionsTool({
    actions: actions as unknown as ActionsApi,
    tabs,
    needs,
    bodyName: 'Chrome',
  });
  return { t, actions, asked };
}

const rejection = (p: Promise<unknown>): Promise<RpcError> =>
  p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e as RpcError,
  );

const text = (parts: { type: string; text?: string }[]): string => parts[0]?.text ?? '';

describe('tab_actions tool', () => {
  it('declared_effect_is_change_without_confirm', () => {
    const { t } = setup();
    expect(t.tool.name).toBe('tab_actions');
    expect(t.tool.effect).toBe('change');
    expect('confirm' in t.tool).toBe(false);
    expect(t.tool.description.endsWith('This is the Chrome browser.')).toBe(true);
  });

  it('open_accepts_http_and_https_only', async () => {
    const { t, actions } = setup();
    for (const url of [
      'javascript:alert(1)',
      'file:///c:/a',
      'chrome://settings',
      'data:text/html,x',
      'about:blank',
    ]) {
      const e = await rejection(t.run({ action: 'open', url }));
      expect(e.code, url).toBe(ErrorCode.invalid_params);
      expect(e.message).toContain('only http and https addresses');
    }
    expect(actions.open).not.toHaveBeenCalled();
    const out = await t.run({ action: 'open', url: 'https://a.test/page' });
    expect(actions.open).toHaveBeenCalledWith('https://a.test/page');
    expect(text(out as never)).toContain('https://a.test/page');
    await t.run({ action: 'open', url: 'http://a.test/' });
    expect(actions.open).toHaveBeenCalledTimes(2);
  });

  it('open_with_search_uses_the_search_permission', async () => {
    const { t, actions, asked } = setup();
    const out = await t.run({ action: 'open', search: 'cat videos' });
    expect(asked).toEqual([{ kind: 'permission', name: 'search' }]);
    expect(actions.search).toHaveBeenCalledWith('cat videos');
    expect(actions.open).not.toHaveBeenCalled();
    expect(text(out as never)).toContain('cat videos');
  });

  it('open_needs_url_or_search_not_both_missing', async () => {
    const { t, actions } = setup();
    const e = await rejection(t.run({ action: 'open' }));
    expect(e.code).toBe(ErrorCode.invalid_params);
    const blank = await rejection(t.run({ action: 'open', search: '  ' }));
    expect(blank.code).toBe(ErrorCode.invalid_params);
    expect(actions.open).not.toHaveBeenCalled();
    expect(actions.search).not.toHaveBeenCalled();
  });

  it('close_and_switch_need_a_tab_id_and_ask_nothing', async () => {
    const { t, actions, asked } = setup();
    const noId = await rejection(t.run({ action: 'close' }));
    expect(noId.code).toBe(ErrorCode.invalid_params);
    const badId = await rejection(t.run({ action: 'switch', tab_id: 'x' }));
    expect(badId.code).toBe(ErrorCode.invalid_params);
    await t.run({ action: 'close', tab_id: 3 });
    await t.run({ action: 'switch', tab_id: 4 });
    expect(actions.close).toHaveBeenCalledWith(3);
    expect(actions.switchTo).toHaveBeenCalledWith(4);
    expect(asked).toEqual([]);
  });

  it('group_asks_for_tabGroups_and_names_the_group', async () => {
    const { t, actions, asked } = setup();
    const none = await rejection(t.run({ action: 'group' }));
    expect(none.code).toBe(ErrorCode.invalid_params);
    const empty = await rejection(t.run({ action: 'group', tab_ids: [] }));
    expect(empty.code).toBe(ErrorCode.invalid_params);
    const junk = await rejection(t.run({ action: 'group', tab_ids: [1, 'b'] }));
    expect(junk.code).toBe(ErrorCode.invalid_params);
    const out = await t.run({ action: 'group', tab_ids: [1, 2], title: 'Trip' });
    expect(asked).toEqual([{ kind: 'permission', name: 'tabGroups' }]);
    expect(actions.group).toHaveBeenCalledWith([1, 2], 'Trip');
    expect(text(out as never)).toContain('Trip');
  });

  it('reopen_asks_for_sessions_and_says_when_nothing_was_closed', async () => {
    const { t, actions, asked } = setup();
    const out = await t.run({ action: 'reopen' });
    expect(asked).toEqual([{ kind: 'permission', name: 'sessions' }]);
    expect(text(out as never)).toContain('Back');
    actions.reopen.mockResolvedValueOnce(null);
    const none = await t.run({ action: 'reopen' });
    expect(text(none as never)).toContain('Nothing was recently closed');
  });

  it('bookmark_defaults_to_the_active_tab', async () => {
    const { t, actions, asked } = setup();
    await t.run({ action: 'bookmark' });
    expect(asked).toEqual([
      { kind: 'permission', name: 'bookmarks' },
      { kind: 'permission', name: 'tabs' },
    ]);
    expect(actions.bookmark).toHaveBeenCalledWith('Active page', 'https://a.test/x');
    await t.run({ action: 'bookmark', title: 'Mine', url: 'https://c.test/' });
    expect(actions.bookmark).toHaveBeenLastCalledWith('Mine', 'https://c.test/');
    await t.run({ action: 'reading_list' });
    expect(actions.addToReadingList).toHaveBeenCalledWith('Active page', 'https://a.test/x');
  });

  it('a_url_without_a_title_is_saved_under_the_url_and_skips_the_tabs_ask', async () => {
    const { t, actions, asked } = setup();
    await t.run({ action: 'bookmark', url: 'https://c.test/p' });
    expect(actions.bookmark).toHaveBeenCalledWith('https://c.test/p', 'https://c.test/p');
    await t.run({ action: 'reading_list', url: 'https://c.test/q' });
    expect(actions.addToReadingList).toHaveBeenCalledWith('https://c.test/q', 'https://c.test/q');
    expect(asked.map((n) => (n as { name: string }).name)).toEqual(['bookmarks', 'readingList']);
  });

  it('bookmark_with_no_active_tab_fails_plainly', async () => {
    const { t, actions } = setup(null);
    const e = await rejection(t.run({ action: 'bookmark' }));
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toContain('no active tab');
    expect(actions.bookmark).not.toHaveBeenCalled();
  });

  it('reading_list_unsupported_is_tool_failed', async () => {
    const { t, actions } = setup();
    actions.addToReadingList.mockRejectedValueOnce(new Error('not supported in this browser'));
    const e = await rejection(
      t.run({ action: 'reading_list', title: 'T', url: 'https://a.test/' }),
    );
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toContain('not supported in this browser');
  });

  it.each([
    ['group', { action: 'group', tab_ids: [1] }, 'group'],
    ['reopen', { action: 'reopen' }, 'reopen'],
    ['open with search', { action: 'open', search: 'cats' }, 'search'],
    ['bookmark', { action: 'bookmark' }, 'bookmark'],
    ['reading_list', { action: 'reading_list' }, 'addToReadingList'],
  ] as const)('denied_permission_surfaces_its_sentence: %s', async (_name, input, api) => {
    const sentence = 'the person has not allowed Scout to do that';
    const { t, actions } = setup(ACTIVE, async () => {
      throw new RpcError(ErrorCode.tool_failed, sentence);
    });
    const e = await rejection(t.run({ ...input }));
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toBe(sentence);
    expect(actions[api]).not.toHaveBeenCalled();
  });

  it('bookmark_and_reading_list_share_one_permission_deadline', async () => {
    const waits: (number | undefined)[] = [];
    const { t } = setup(ACTIVE, async (_need, _reason, waitMs) => {
      waits.push(waitMs);
    });
    await t.run({ action: 'bookmark' });
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeLessThanOrEqual(25_000);
    expect(waits[1]).toBeLessThanOrEqual(waits[0]!);
  });

  it('bookmark_and_reading_list_accept_web_addresses_only', async () => {
    const { t, actions, asked } = setup();
    for (const action of ['bookmark', 'reading_list']) {
      for (const url of ['javascript:alert(1)', 'file:///c:/a', 'chrome://settings']) {
        const e = await rejection(t.run({ action, title: 'T', url }));
        expect(e.code, `${action} ${url}`).toBe(ErrorCode.invalid_params);
      }
    }
    expect(actions.bookmark).not.toHaveBeenCalled();
    expect(actions.addToReadingList).not.toHaveBeenCalled();
    expect(asked).toEqual([]);
  });

  it('unknown_action_is_invalid_params', async () => {
    const { t } = setup();
    const e = await rejection(t.run({ action: 'explode' }));
    expect(e.code).toBe(ErrorCode.invalid_params);
  });
});
