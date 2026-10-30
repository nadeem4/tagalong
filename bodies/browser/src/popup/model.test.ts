/**
 * Tests for the popup's pure part: the status sentence and the list of what Scout has
 * been allowed, turned into plain rows.
 */
import { describe, expect, it } from 'vitest';
import { grantRows, statusLine } from './model';

describe('statusLine', () => {
  it('has_one_sentence_per_status', () => {
    expect(statusLine('connecting')).toBe("Connecting to Scout's brain...");
    expect(statusLine('online')).toBe("Connected to Scout's brain");
    expect(statusLine('offline')).toBe("Scout's brain is not reachable");
    expect(statusLine('outdated')).toBe(
      'Needs an update: this browser add-on is older than the brain',
    );
  });
});

describe('grantRows', () => {
  it('lists_only_what_scout_can_ask_for', () => {
    const rows = grantRows({ permissions: ['storage', 'history', 'alarms'], origins: [] });
    expect(rows).toEqual([{ label: 'history', need: { kind: 'permission', name: 'history' } }]);
  });

  it('turns_origins_into_site_names', () => {
    const rows = grantRows({ permissions: [], origins: ['https://x.com/*', 'http://a.b.org/*'] });
    expect(rows).toEqual([
      { label: 'x.com', need: { kind: 'site', origin: 'https://x.com' } },
      { label: 'a.b.org', need: { kind: 'site', origin: 'http://a.b.org' } },
    ]);
  });

  it('shows_granted_local_files_as_one_row', () => {
    const rows = grantRows({ permissions: [], origins: ['file:///*'] });
    expect(rows).toEqual([{ label: 'Local files', need: { kind: 'site', origin: 'file://' } }]);
  });

  it('collapses_all_urls_to_one_row', () => {
    const rows = grantRows({ permissions: [], origins: ['<all_urls>', 'https://x.com/*'] });
    expect(rows[0]).toEqual({ label: 'All sites', need: { kind: 'site', origin: '<all_urls>' } });
    expect(rows).toHaveLength(1);
  });

  it('is_empty_when_nothing_is_granted', () => {
    expect(grantRows({ permissions: ['storage'], origins: [] })).toEqual([]);
  });
});
