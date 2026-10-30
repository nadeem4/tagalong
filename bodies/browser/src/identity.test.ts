/**
 * Pins how a browser install names itself to the brain.
 * The kind comes from brands or the user agent; the id is random, made once and kept,
 * so two browsers or profiles never collide and a restart reconnects as the same body.
 */
import { describe, expect, it } from 'vitest';
import type { StorageArea } from './layer/api';
import { detectBrowser, loadBodyId, makeBodyId, browserName } from './identity';

function memory(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    get: async (k) => data.get(k),
    set: async (k, v) => {
      data.set(k, v);
    },
  };
}

describe('detectBrowser', () => {
  it('detects_each_browser_from_brands', () => {
    expect(detectBrowser(['Chromium', 'Microsoft Edge'], '')).toBe('edge');
    expect(detectBrowser(['Brave', 'Chromium'], '')).toBe('brave');
    expect(detectBrowser(['Opera', 'Chromium'], '')).toBe('opera');
    expect(detectBrowser(['Vivaldi', 'Chromium'], '')).toBe('vivaldi');
    expect(detectBrowser(['Arc', 'Chromium'], '')).toBe('arc');
    expect(detectBrowser(['Chromium', 'Google Chrome'], '')).toBe('chrome');
    expect(detectBrowser(['Chromium'], '')).toBe('chromium');
  });

  it('falls_back_to_the_user_agent', () => {
    expect(detectBrowser([], 'Mozilla/5.0 Chrome/120 Safari/537 Edg/120')).toBe('edge');
    expect(detectBrowser([], 'Mozilla/5.0 Chrome/120 Safari/537 OPR/100')).toBe('opera');
    expect(detectBrowser([], 'Mozilla/5.0 Chrome/120 Safari/537 Vivaldi/6')).toBe('vivaldi');
    expect(detectBrowser([], 'Mozilla/5.0 Chrome/120 Safari/537')).toBe('chrome');
    expect(detectBrowser([], 'SomethingElse/1')).toBe('chromium');
  });
});

describe('browserName', () => {
  it('gives the display name', () => {
    expect(browserName('chrome')).toBe('Chrome');
    expect(browserName('edge')).toBe('Edge');
    expect(browserName('chromium')).toBe('Chromium');
  });
});

describe('body id', () => {
  it('body_id_matches_the_contract_pattern', () => {
    const id = makeBodyId('chrome', () => '7k2f');
    expect(id).toBe('chrome-7k2f');
    expect(id).toMatch(/^[a-z0-9-]{1,32}$/);
  });

  it('body_id_default_random_is_four_lowercase_alphanumerics', async () => {
    const id = await loadBodyId(memory(), 'vivaldi');
    expect(id).toMatch(/^vivaldi-[a-z0-9]{4}$/);
  });

  it('body_id_is_made_once_and_kept', async () => {
    const storage = memory();
    const first = await loadBodyId(storage, 'chrome', () => 'aaaa');
    const second = await loadBodyId(storage, 'chrome', () => 'bbbb');
    expect(first).toBe('chrome-aaaa');
    expect(second).toBe('chrome-aaaa');
  });

  it('an_invalid_stored_id_is_replaced_with_a_fresh_saved_one', async () => {
    const storage = memory();
    await storage.set('bodyId', 'BAD ID!');
    const id = await loadBodyId(storage, 'edge', () => 'zzzz');
    expect(id).toBe('edge-zzzz');
    expect(await storage.get('bodyId')).toBe('edge-zzzz');
  });

  it('two_installs_get_different_ids', async () => {
    const a = await loadBodyId(memory(), 'chrome', () => 'aaaa');
    const b = await loadBodyId(memory(), 'chrome', () => 'bbbb');
    expect(a).not.toBe(b);
  });
});
