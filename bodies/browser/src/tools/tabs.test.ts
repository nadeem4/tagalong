/**
 * Tests for the tabs tool, driven by fake tabs, page reader and permission needs.
 * Covers list, read, the sleeping and locked-page refusals, and permission denials.
 */
import { ErrorCode, RpcError } from '@tagalong/contract';
import { describe, expect, it, vi } from 'vitest';
import type { PageApi, TabInfo, TabsApi } from '../layer/api';
import type { PageReading } from '../content/read-page';
import type { Need } from '../permissions';
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
  opts: { tabs?: TabInfo[]; reading?: PageReading; denyWith?: RpcError; denySite?: RpcError } = {},
) {
  const all = opts.tabs ?? [tab()];
  const calls: Need[] = [];
  const tabs: TabsApi = {
    list: async () => all,
    get: async (id) => all.find((t) => t.id === id) ?? null,
    activeInFocusedWindow: async () => all.find((t) => t.active) ?? null,
  };
  const read = vi.fn(async (_id: number) => opts.reading ?? reading());
  const page: PageApi = { read };
  const needs: Needs = {
    ensure: async (need) => {
      calls.push(need);
      if (opts.denyWith) throw opts.denyWith;
      if (opts.denySite && need.kind === 'site') throw opts.denySite;
    },
  };
  const t = tabsTool({ tabs, page, needs, bodyName: 'Chrome' });
  const text = async (input: Record<string, unknown>) => {
    const parts = await t.run(input);
    expect(parts).toHaveLength(1);
    return (parts[0] as { text: string }).text;
  };
  return { t, calls, read, text };
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
