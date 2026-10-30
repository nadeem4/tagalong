/**
 * Tests for the browser's two facts to the brain: the tab in front and finished downloads.
 * The reporter runs on a fake clock and a fake send, so throttling is exact and repeatable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTabReporter, downloadEvent, stripUrl, TAB_THROTTLE_MS } from './events';

describe('stripUrl', () => {
  it('stripUrl_drops_query_and_fragment', () => {
    expect(stripUrl('https://a.test/path/x?token=1#top')).toBe('https://a.test/path/x');
  });

  it('stripUrl_ignores_non_web_urls', () => {
    expect(stripUrl('chrome://settings')).toBe('');
    expect(stripUrl('file:///C:/a.txt')).toBe('');
    expect(stripUrl('javascript:alert(1)')).toBe('');
    expect(stripUrl('not a url')).toBe('');
    expect(stripUrl('')).toBe('');
  });
});

describe('createTabReporter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(accept = true) {
    const sent: { name: string; data: unknown }[] = [];
    let ok = accept;
    const report = createTabReporter({
      send: (name, data) => {
        if (ok) sent.push({ name, data });
        return ok;
      },
      now: () => Date.now(),
    });
    return {
      report,
      sent,
      setOk(v: boolean) {
        ok = v;
      },
    };
  }

  it('a_burst_of_tab_changes_sends_one_event_per_2s_with_the_last_value', () => {
    const { report, sent } = setup();
    report({ title: 'A', url: 'https://a.test/?q=1' });
    vi.advanceTimersByTime(200);
    report({ title: 'B', url: 'https://b.test/' });
    vi.advanceTimersByTime(300);
    report({ title: 'C', url: 'https://c.test/' });
    expect(sent).toEqual([{ name: 'tab', data: { title: 'A', url: 'https://a.test/' } }]);
    vi.advanceTimersByTime(TAB_THROTTLE_MS);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ name: 'tab', data: { title: 'C', url: 'https://c.test/' } });
  });

  it('the_same_tab_twice_is_sent_once', () => {
    const { report, sent } = setup();
    report({ title: 'A', url: 'https://a.test/' });
    vi.advanceTimersByTime(TAB_THROTTLE_MS);
    report({ title: 'A', url: 'https://a.test/#x' });
    vi.advanceTimersByTime(TAB_THROTTLE_MS * 2);
    expect(sent).toHaveLength(1);
  });

  it('a_tab_with_no_readable_url_sends_nothing', () => {
    const { report, sent } = setup();
    report({ title: 'Hidden', url: '' });
    report({ title: 'Settings', url: 'chrome://settings' });
    vi.advanceTimersByTime(TAB_THROTTLE_MS * 2);
    expect(sent).toHaveLength(0);
  });

  it('send_returning_false_is_tried_with_the_next_change', () => {
    const { report, sent, setOk } = setup(false);
    report({ title: 'A', url: 'https://a.test/' });
    expect(sent).toHaveLength(0);
    setOk(true);
    report({ title: 'A', url: 'https://a.test/' });
    expect(sent).toHaveLength(1);
  });
});

describe('downloadEvent', () => {
  it('downloadEvent_keeps_only_the_base_name', () => {
    expect(
      downloadEvent({ filename: 'C:\\Users\\a\\Downloads\\tax.pdf', state: 'complete' }),
    ).toEqual({ name: 'tax.pdf', state: 'complete' });
    expect(downloadEvent({ filename: '/home/a/tax.pdf', state: 'complete' })?.name).toBe('tax.pdf');
  });

  it('downloadEvent_maps_complete_and_interrupted_and_ignores_in_progress', () => {
    expect(downloadEvent({ filename: 'a.zip', state: 'interrupted' })?.state).toBe('interrupted');
    expect(downloadEvent({ filename: 'a.zip', state: 'in_progress' })).toBeNull();
  });

  it('downloadEvent_sends_nothing_when_the_name_is_empty', () => {
    expect(downloadEvent({ filename: '', state: 'interrupted' })).toBeNull();
    expect(downloadEvent({ filename: 'C:\\dl\\', state: 'interrupted' })).toBeNull();
  });
});
