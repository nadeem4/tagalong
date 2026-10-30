/**
 * Tests for the tabs tool, driven by fake tabs, page reader and permission needs.
 * Covers list, read, the sleeping and locked-page refusals, and permission denials.
 */
import { ErrorCode, RpcError } from '@tagalong/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageApi, TabInfo, TabsApi } from '../layer/api';
import type { PageReading } from '../content/read-page';
import {
  PERMISSION_WAIT_MS,
  PermissionBroker,
  type Need,
  type PermissionPrompt,
  type PermissionsApi,
} from '../permissions';
import { tabsTool, type Needs } from './tabs';

const tab = (over: Partial<TabInfo> = {}): TabInfo => ({
  id: 1,
  windowId: 1,
  title: 'Example',
  url: 'https://example.com/a',
  active: true,
  discarded: false,
  ...over,
});

const reading = (over: Partial<PageReading> = {}): PageReading => ({
  url: 'https://example.com/a',
  title: 'Example',
  selection: '',
  selectionTruncated: false,
  text: 'Hello page',
  truncated: false,
  ...over,
});

function setup(
  opts: {
    tabs?: TabInfo[];
    reading?: PageReading;
    denyWith?: RpcError;
    denySite?: RpcError;
    /** Runs once the site is allowed, to model the person switching tabs meanwhile. */
    afterSite?: (all: TabInfo[]) => void;
  } = {},
) {
  const all = opts.tabs ?? [tab()];
  const calls: Need[] = [];
  const tabs: TabsApi = {
    list: async () => all,
    get: async (id) => all.find((t) => t.id === id) ?? null,
    activeInFocusedWindow: async () => all.find((t) => t.active) ?? null,
  };
  const read = vi.fn(async (_id: number) => opts.reading ?? reading());
  const page: PageApi = { read, parts: async () => '' };
  const needs: Needs = {
    ensure: async (need) => {
      calls.push(need);
      if (opts.denyWith) throw opts.denyWith;
      if (opts.denySite && need.kind === 'site') throw opts.denySite;
      if (need.kind === 'site') opts.afterSite?.(all);
    },
  };
  const capture = vi.fn(
    async (_windowId: number): Promise<{ mime: 'image/jpeg'; base64: string }> => ({
      mime: 'image/jpeg',
      base64: 'AAAA',
    }),
  );
  const t = tabsTool({ tabs, page, picture: { capture }, needs, bodyName: 'Chrome' });
  const text = async (input: Record<string, unknown>) => {
    const parts = await t.run(input);
    expect(parts).toHaveLength(1);
    return (parts[0] as { text: string }).text;
  };
  return { t, calls, read, capture, text };
}

const rejection = (p: Promise<unknown>): Promise<RpcError> =>
  p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e as RpcError,
  );

describe('tabs tool declaration', () => {
  it('is a read tool whose description ends with the body name', () => {
    const { t } = setup();
    expect(t.tool.name).toBe('tabs');
    expect(t.tool.effect).toBe('read');
    expect(t.tool.description.endsWith('This is the Chrome browser.')).toBe(true);
  });
});

describe('tabs list', () => {
  it('list_returns_id_title_url_active_asleep', async () => {
    const { text } = setup({
      tabs: [
        tab(),
        tab({ id: 2, title: 'B', url: 'https://b.test/', active: false, discarded: true }),
      ],
    });
    expect(JSON.parse(await text({ action: 'list' }))).toEqual({
      tabs: [
        { id: 1, title: 'Example', url: 'https://example.com/a', active: true, asleep: false },
        { id: 2, title: 'B', url: 'https://b.test/', active: false, asleep: true },
      ],
    });
  });

  it('list_asks_for_the_tabs_permission_first', async () => {
    const { text, calls } = setup();
    await text({ action: 'list' });
    expect(calls).toEqual([{ kind: 'permission', name: 'tabs' }]);
  });
});

describe('tabs read', () => {
  it('read_defaults_to_the_active_tab', async () => {
    const { text, read } = setup({
      tabs: [tab({ id: 5, active: true }), tab({ id: 6, active: false })],
    });
    await text({ action: 'read' });
    expect(read).toHaveBeenCalledWith(5);
  });

  it('read_by_tab_id', async () => {
    const { text, read } = setup({ tabs: [tab({ id: 5 }), tab({ id: 6, active: false })] });
    await text({ action: 'read', tab_id: 6 });
    expect(read).toHaveBeenCalledWith(6);
  });

  it('read_asks_tabs_then_the_site', async () => {
    const { text, calls } = setup();
    await text({ action: 'read' });
    expect(calls).toEqual([
      { kind: 'permission', name: 'tabs' },
      { kind: 'site', origin: 'https://example.com' },
    ]);
  });

  it('read_of_a_local_file_asks_for_the_file_origin', async () => {
    const { text, calls } = setup({ tabs: [tab({ url: 'file:///C:/notes/a.txt' })] });
    await text({ action: 'read' });
    expect(calls[1]).toEqual({ kind: 'site', origin: 'file://' });
  });

  it('read_formats_url_title_selection_and_text', async () => {
    const { text } = setup({ reading: reading({ selection: 'picked', text: 'Body text' }) });
    expect(await text({ action: 'read' })).toBe(
      'url: https://example.com/a\ntitle: Example\nselection: picked\n\nBody text',
    );
  });

  it('read_omits_selection_when_empty', async () => {
    const { text } = setup();
    expect(await text({ action: 'read' })).toBe(
      'url: https://example.com/a\ntitle: Example\n\nHello page',
    );
  });

  it('read_adds_the_truncated_note_at_40000', async () => {
    const { text } = setup({ reading: reading({ text: 'x'.repeat(40_001), truncated: true }) });
    const out = await text({ action: 'read' });
    expect(out.endsWith('\n[truncated at 40,000 characters]')).toBe(true);
    const body = out.slice(out.indexOf('\n\n') + 2, out.lastIndexOf('\n['));
    expect(body.length).toBe(40_000);
  });

  it('read_of_a_sleeping_tab_fails_asleep_without_reading', async () => {
    const { t, read } = setup({ tabs: [tab({ discarded: true })] });
    const e = await rejection(t.run({ action: 'read' }));
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toMatch(/asleep/);
    expect(e.message).toMatch(/will not wake/);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['chrome://settings', /browser/i],
    ['chrome-extension://x/a.html', /extension/i],
    ['https://chromewebstore.google.com/detail/x', /web store/i],
    ['https://chrome.google.com/webstore/detail/x', /web store/i],
    ['https://microsoftedge.microsoft.com/addons/detail/x', /add-ons store/i],
    ['view-source:https://example.com', /browser/i],
  ])('read_of_a_locked_page_fails_plainly: %s', async (url, what) => {
    const { t, read } = setup({ tabs: [tab({ url })] });
    const e = await rejection(t.run({ action: 'read' }));
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toMatch(what);
    expect(read).not.toHaveBeenCalled();
  });

  it('read_with_no_active_tab_fails', async () => {
    const { t } = setup({ tabs: [] });
    const e = await rejection(t.run({ action: 'read' }));
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toMatch(/no active tab/i);
  });

  it('read_with_an_unknown_tab_id_fails', async () => {
    const { t } = setup();
    const e = await rejection(t.run({ action: 'read', tab_id: 99 }));
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toMatch(/no tab/i);
  });

  it('read_when_the_reader_throws_is_tool_failed_with_a_plain_reason', async () => {
    const { t, read } = setup();
    read.mockRejectedValueOnce(new Error('Cannot access contents of the page'));
    const e = await rejection(t.run({ action: 'read' }));
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toMatch(/could not read/i);
    expect(e.message).toContain('Cannot access contents of the page');
  });
});

describe('tabs picture', () => {
  it('picture_returns_one_image_part', async () => {
    const { t, capture } = setup({ tabs: [tab({ id: 5, windowId: 3 })] });
    expect(await t.run({ action: 'picture' })).toEqual([
      { type: 'image', mime: 'image/jpeg', data: 'AAAA' },
    ]);
    expect(capture).toHaveBeenCalledWith(3);
  });

  it('picture_of_a_background_tab_fails_and_never_switches_tabs', async () => {
    const { t, capture } = setup({
      tabs: [tab({ id: 5 }), tab({ id: 6, active: false })],
    });
    const e = await rejection(t.run({ action: 'picture', tab_id: 6 }));
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toMatch(/only the tab in front/i);
    expect(capture).not.toHaveBeenCalled();
  });

  it('picture_asks_tabs_then_the_site', async () => {
    const { t, calls } = setup();
    await t.run({ action: 'picture' });
    expect(calls).toEqual([
      { kind: 'permission', name: 'tabs' },
      { kind: 'site', origin: 'https://example.com' },
    ]);
  });

  it('picture_of_a_sleeping_or_locked_tab_fails_like_read', async () => {
    const asleep = setup({ tabs: [tab({ discarded: true })] });
    const a = await rejection(asleep.t.run({ action: 'picture' }));
    expect(a.code).toBe(ErrorCode.tool_failed);
    expect(a.message).toMatch(/asleep/);
    const locked = setup({ tabs: [tab({ url: 'chrome://settings' })] });
    const l = await rejection(locked.t.run({ action: 'picture' }));
    expect(l.code).toBe(ErrorCode.tool_failed);
    expect(l.message).toMatch(/browser/i);
    expect(asleep.capture).not.toHaveBeenCalled();
    expect(locked.capture).not.toHaveBeenCalled();
  });

  it('picture_after_a_denied_site_or_tabs_never_captures', async () => {
    const site = new RpcError(ErrorCode.denied, 'You did not allow Scout on this site.');
    const a = setup({ denySite: site });
    expect(await rejection(a.t.run({ action: 'picture' }))).toBe(site);
    const tabsDenied = new RpcError(ErrorCode.denied, 'You did not allow Scout to see your tabs.');
    const b = setup({ denyWith: tabsDenied });
    expect(await rejection(b.t.run({ action: 'picture' }))).toBe(tabsDenied);
    expect(a.capture).not.toHaveBeenCalled();
    expect(b.capture).not.toHaveBeenCalled();
  });

  it('picture_fails_if_the_tab_in_front_changed_while_asking', async () => {
    const other = setup({
      tabs: [tab({ id: 1 }), tab({ id: 2, active: false })],
      afterSite: (all) => {
        all[0] = tab({ id: 1, active: false });
        all[1] = tab({ id: 2, active: true });
      },
    });
    const e = await rejection(other.t.run({ action: 'picture' }));
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toMatch(/changed while I was asking/);
    const moved = setup({
      afterSite: (all) => {
        all[0] = tab({ url: 'https://evil.test/x' });
      },
    });
    const m = await rejection(moved.t.run({ action: 'picture' }));
    expect(m.code).toBe(ErrorCode.tool_failed);
    expect(other.capture).not.toHaveBeenCalled();
    expect(moved.capture).not.toHaveBeenCalled();
  });

  it('picture_fails_plainly_if_the_tab_address_became_unreadable_while_asking', async () => {
    const s = setup({
      afterSite: (all) => {
        all[0] = tab({ url: '' });
      },
    });
    const e = await rejection(s.t.run({ action: 'picture' }));
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toMatch(/changed while I was asking/);
    expect(s.capture).not.toHaveBeenCalled();
  });

  it('picture_failure_from_the_browser_is_tool_failed_with_a_plain_reason', async () => {
    const { t, capture } = setup();
    capture.mockRejectedValueOnce(new Error('Cannot capture this window'));
    const e = await rejection(t.run({ action: 'picture' }));
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toMatch(/could not take a picture/i);
    expect(e.message).toContain('Cannot capture this window');
  });
});

describe('tabs input and permissions', () => {
  it('unknown_action_is_invalid_params', async () => {
    const { t } = setup();
    const e = await rejection(t.run({ action: 'close' }));
    expect(e.code).toBe(ErrorCode.invalid_params);
  });

  it('a_denied_permission_surfaces_its_sentence', async () => {
    const denied = new RpcError(ErrorCode.denied, 'You did not allow Scout to see your tabs.');
    const { t } = setup({ denyWith: denied });
    const e = await rejection(t.run({ action: 'list' }));
    expect(e).toBe(denied);
  });

  it('read_notes_a_cut_even_when_the_reader_did_not_flag_it', async () => {
    const { text } = setup({ reading: reading({ text: 'x'.repeat(40_001), truncated: false }) });
    expect((await text({ action: 'read' })).endsWith('\n[truncated at 40,000 characters]')).toBe(
      true,
    );
  });

  it('read_with_a_non_number_tab_id_is_invalid_params', async () => {
    const { t } = setup();
    const e = await rejection(t.run({ action: 'read', tab_id: '6' }));
    expect(e.code).toBe(ErrorCode.invalid_params);
  });

  it('a_denied_site_stops_the_read', async () => {
    const denied = new RpcError(ErrorCode.denied, 'You did not allow Scout on this site.');
    const { t, read } = setup({ denySite: denied });
    expect(await rejection(t.run({ action: 'read' }))).toBe(denied);
    expect(read).not.toHaveBeenCalled();
  });

  it('a_sleeping_tab_never_asks_the_site_need', async () => {
    const { t, calls } = setup({ tabs: [tab({ discarded: true })] });
    await rejection(t.run({ action: 'read' }));
    expect(calls.some((n) => n.kind === 'site')).toBe(false);
  });
});

describe('tabs read deadline', () => {
  afterEach(() => vi.useRealTimers());

  it('one_read_gives_up_after_one_wait_even_when_it_needs_two_permissions', async () => {
    vi.useFakeTimers();
    let tabsHeld = false;
    const api: PermissionsApi = {
      contains: async (need) => need.kind === 'permission' && tabsHeld,
      getAll: async () => ({ permissions: [], origins: [] }),
      remove: async () => true,
    };
    // The tabs question is answered after 10 s; the site question is never answered.
    const prompt: PermissionPrompt = {
      ask: (need) =>
        need.kind === 'site'
          ? new Promise(() => undefined)
          : new Promise((resolve) =>
              setTimeout(() => {
                tabsHeld = true;
                resolve('granted');
              }, 10_000),
            ),
    };
    const broker = new PermissionBroker(api, prompt);
    const t = tabsTool({
      tabs: {
        list: async () => [tab()],
        get: async () => tab(),
        activeInFocusedWindow: async () => tab(),
      },
      page: {
        read: async () => reading(),
        parts: () => Promise.reject(new Error('unused')),
      },
      picture: { capture: () => Promise.reject(new Error('unused')) },
      needs: broker,
      bodyName: 'Chrome',
    });
    const outcome = rejection(t.run({ action: 'read' }));
    await vi.advanceTimersByTimeAsync(PERMISSION_WAIT_MS);
    const e = await outcome;
    expect(e.code).toBe(ErrorCode.tool_failed);
    expect(e.message).toBe('the person has not allowed reading example.com');
  });

  it('the_site_wait_gets_only_the_time_the_tabs_wait_left', async () => {
    vi.useFakeTimers();
    const asked: number[] = [];
    const needs: Needs = {
      ensure: async (_need, _reason, ms) => {
        asked.push(ms ?? PERMISSION_WAIT_MS);
        if (asked.length === 1) await new Promise((r) => setTimeout(r, 10_000));
      },
    };
    const t = tabsTool({
      tabs: {
        list: async () => [tab()],
        get: async () => tab(),
        activeInFocusedWindow: async () => tab(),
      },
      page: {
        read: async () => reading(),
        parts: () => Promise.reject(new Error('unused')),
      },
      picture: { capture: () => Promise.reject(new Error('unused')) },
      needs,
      bodyName: 'Chrome',
    });
    const done = t.run({ action: 'read' });
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(asked).toEqual([PERMISSION_WAIT_MS, PERMISSION_WAIT_MS - 10_000]);
  });
});
