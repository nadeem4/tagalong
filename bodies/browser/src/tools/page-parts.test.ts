/**
 * Tests for the page_parts tool, driven by fake tabs, page API and permission needs.
 * Covers the permission order, sleeping and locked refusals and input checks.
 */
import { ErrorCode, RpcError } from '@tagalong/contract';
import { describe, expect, it, vi } from 'vitest';
import type { PageApi, TabInfo, TabsApi } from '../layer/api';
import type { Need } from '../permissions';
import { pagePartsTool } from './page-parts';
import type { Needs } from './tabs';

const tab = (over: Partial<TabInfo> = {}): TabInfo => ({
  id: 1,
  windowId: 1,
  title: 'Example',
  url: 'https://example.com/a',
  active: true,
  discarded: false,
  ...over,
});

function setup(all: TabInfo[] = [tab()]) {
  const calls: Need[] = [];
  const tabs: TabsApi = {
    list: async () => all,
    get: async (id) => all.find((t) => t.id === id) ?? null,
    activeInFocusedWindow: async () => all.find((t) => t.active) ?? null,
  };
  const parts = vi.fn(async (_id: number, _part: string) => 'the parts');
  const page: PageApi = { read: vi.fn(), parts };
  const needs: Needs = {
    ensure: async (need) => {
      calls.push(need);
    },
  };
  const t = pagePartsTool({ tabs, page, needs, bodyName: 'Chrome' });
  return { t, calls, parts };
}

const rejection = (p: Promise<unknown>): Promise<RpcError> =>
  p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e as RpcError,
  );

describe('page_parts tool', () => {
  it('is a read tool named page_parts', () => {
    const { t } = setup();
    expect(t.tool.name).toBe('page_parts');
    expect(t.tool.effect).toBe('read');
    expect(t.tool.description.endsWith('This is the Chrome browser.')).toBe(true);
  });

  it('asks_tabs_then_the_site', async () => {
    const { t, calls } = setup();
    await t.run({ part: 'links' });
    expect(calls).toEqual([
      { kind: 'permission', name: 'tabs' },
      { kind: 'site', origin: 'https://example.com' },
    ]);
  });

  it('sleeping_and_locked_tabs_fail_plainly', async () => {
    const asleep = setup([tab({ discarded: true })]);
    const e1 = await rejection(asleep.t.run({ part: 'links' }));
    expect(e1.code).toBe(ErrorCode.tool_failed);
    expect(e1.message).toContain('asleep');
    expect(asleep.parts).not.toHaveBeenCalled();

    const locked = setup([tab({ url: 'chrome://settings' })]);
    const e2 = await rejection(locked.t.run({ part: 'links' }));
    expect(e2.code).toBe(ErrorCode.tool_failed);
    expect(e2.message).toContain('browser itself');
  });

  it('unknown_part_is_invalid_params', async () => {
    const { t } = setup();
    const e = await rejection(t.run({ part: 'cookies' }));
    expect(e.code).toBe(ErrorCode.invalid_params);
  });

  it('returns_the_text_from_the_page_api', async () => {
    const { t, parts } = setup();
    const out = await t.run({ part: 'headings', tab_id: 1 });
    expect(out).toEqual([{ type: 'text', text: 'the parts' }]);
    expect(parts).toHaveBeenCalledWith(1, 'headings');
  });
});
