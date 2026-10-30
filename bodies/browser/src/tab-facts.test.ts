/**
 * Tests the worker's tab-fact wiring: a tab is a fact only with the `tabs` allow held and never
 * from a private window. Chrome fills url and title from host access alone, so the gate is ours.
 */
import { describe, expect, it, vi } from 'vitest';
import { tabFactSender } from './tab-facts';

function setup(held: boolean) {
  const send = vi.fn();
  const contains = vi.fn(async () => held);
  return { send, contains, push: tabFactSender({ contains }, send) };
}

describe('tabFactSender', () => {
  it('tabFact_sent_when_the_tabs_allow_is_held', async () => {
    const { send, contains, push } = setup(true);
    await push({ title: 'Docs', url: 'https://a.test/x' });
    expect(contains).toHaveBeenCalledWith({ kind: 'permission', name: 'tabs' });
    expect(send).toHaveBeenCalledWith({ title: 'Docs', url: 'https://a.test/x' });
  });

  it('tabFact_dropped_without_the_tabs_allow', async () => {
    const { send, push } = setup(false);
    await push({ title: 'Docs', url: 'https://a.test/x' });
    expect(send).not.toHaveBeenCalled();
  });

  it('tabFact_dropped_for_a_private_window', async () => {
    const { send, contains, push } = setup(true);
    await push({ title: 'Docs', url: 'https://a.test/x', incognito: true });
    expect(send).not.toHaveBeenCalled();
    expect(contains).not.toHaveBeenCalled();
  });

  it('tabFact_missing_title_and_url_become_empty_strings', async () => {
    const { send, push } = setup(true);
    await push({});
    expect(send).toHaveBeenCalledWith({ title: '', url: '' });
  });
});
