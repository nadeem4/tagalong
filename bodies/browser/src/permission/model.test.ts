/**
 * Tests for the permission window's pure model: its query string, buttons and Chrome request.
 * The window is a page, so the logic worth testing lives here, away from the DOM.
 */
import { describe, expect, it } from 'vitest';
import type { Need } from '../permissions';
import { buttonsFor, chromeRequestFor, parseRequest, requestQuery } from './model';

const siteNeed: Need = { kind: 'site', origin: 'https://example.com' };
const permNeed: Need = { kind: 'permission', name: 'history' };

describe('parseRequest', () => {
  it('parseRequest_round_trips_a_site_need_and_a_permission_need', () => {
    for (const need of [siteNeed, permNeed, { kind: 'site', origin: 'file://' } as Need]) {
      const req = { id: 'abc', need, reason: 'read the page & more' };
      expect(parseRequest(`?${requestQuery(req)}`)).toEqual(req);
    }
  });

  it('parseRequest_rejects_missing_id_unknown_name_and_bad_origin', () => {
    expect(parseRequest('?kind=permission&name=tabs&reason=x')).toBeNull();
    expect(parseRequest('?id=1&kind=permission&name=nuclear&reason=x')).toBeNull();
    expect(parseRequest('?id=1&kind=site&origin=not-a-url&reason=x')).toBeNull();
    expect(parseRequest('?id=1&kind=site&origin=chrome://settings&reason=x')).toBeNull();
    expect(parseRequest('?id=1&kind=site&origin=https://a.test/path&reason=x')).toBeNull();
    expect(parseRequest('?id=1&kind=other&reason=x')).toBeNull();
    expect(parseRequest('?id=1&kind=permission&name=tabs')).toBeNull();
    expect(parseRequest('')).toBeNull();
  });
});

describe('buttonsFor', () => {
  it('site_need_has_three_buttons_and_permission_need_two', () => {
    expect(buttonsFor(siteNeed)).toEqual([
      { label: 'Allow on this site', scope: 'site' },
      { label: 'Allow on all sites', scope: 'all' },
      { label: 'Not now', scope: 'no' },
    ]);
    expect(buttonsFor(permNeed)).toEqual([
      { label: 'Allow', scope: 'once' },
      { label: 'Not now', scope: 'no' },
    ]);
  });
});

describe('chromeRequestFor', () => {
  it('chromeRequestFor_maps_each_scope', () => {
    expect(chromeRequestFor(siteNeed, 'site')).toEqual({ origins: ['https://example.com/*'] });
    expect(chromeRequestFor(siteNeed, 'all')).toEqual({ origins: ['<all_urls>'] });
    expect(chromeRequestFor(permNeed, 'once')).toEqual({ permissions: ['history'] });
  });

  it('chromeRequestFor_maps_local_files_to_the_file_pattern', () => {
    expect(chromeRequestFor({ kind: 'site', origin: 'file://' }, 'site')).toEqual({
      origins: ['file:///*'],
    });
  });

  it('no_scope_requests_nothing', () => {
    expect(chromeRequestFor(siteNeed, 'no')).toBeNull();
    expect(chromeRequestFor(permNeed, 'no')).toBeNull();
  });
});
