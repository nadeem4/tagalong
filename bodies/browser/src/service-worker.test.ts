/**
 * Loads the service worker under a fake `chrome` to hold the one rule Chrome needs: the omnibox
 * and context-menu click listeners exist as soon as the module runs, so a stopped worker that is
 * woken by one of those events receives it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: never[]) => unknown;

function fakeChrome() {
  const event = () => {
    const listeners: Listener[] = [];
    return { listeners, addListener: (f: Listener) => void listeners.push(f) };
  };
  const chrome = {
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), lastError: undefined },
    alarms: { onAlarm: event(), create: vi.fn(() => Promise.resolve()) },
    storage: {
      onChanged: event(),
      local: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
      session: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
    },
    tabs: {
      onActivated: event(),
      onUpdated: event(),
      get: vi.fn(() => Promise.reject(new Error('unused'))),
      query: vi.fn(() => Promise.resolve([])),
    },
    permissions: { onAdded: event(), contains: vi.fn(() => Promise.resolve(false)) },
    omnibox: { onInputEntered: event() },
    contextMenus: {
      onClicked: event(),
      removeAll: vi.fn((done: () => void) => done()),
      create: vi.fn((_props: unknown, done?: () => void) => done?.()),
    },
  };
  return chrome;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the service worker', () => {
  it('registers_the_omnibox_and_menu_listeners_at_load', async () => {
    const chrome = fakeChrome();
    vi.stubGlobal('chrome', chrome);
    await import('./service-worker');
    expect(chrome.omnibox.onInputEntered.listeners).toHaveLength(1);
    expect(chrome.contextMenus.onClicked.listeners).toHaveLength(1);
    expect(chrome.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ask-scout', contexts: ['selection'] }),
      expect.any(Function),
    );
  });

  it('a_click_on_another_menu_item_asks_nothing', async () => {
    const chrome = fakeChrome();
    vi.stubGlobal('chrome', chrome);
    await import('./service-worker');
    const onClicked = chrome.contextMenus.onClicked.listeners[0] as unknown as (
      info: { menuItemId: string; selectionText: string },
      tab: { url: string; title: string },
    ) => void;
    onClicked({ menuItemId: 'other', selectionText: 'x' }, { url: 'https://a.test/', title: 'A' });
    await Promise.resolve();
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });
});
