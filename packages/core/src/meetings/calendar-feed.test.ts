import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { InMemorySecretStore } from '../settings/settings';
import {
  CALENDAR_SECRET,
  CalendarFetchError,
  CalendarFeed,
  FEED_MAX_BYTES,
  FEED_REFRESH_MS,
  httpsFetchText,
  parseMeetings,
  type FetchText,
} from './calendar-feed';

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const WEEKLY = fixture('weekly.ics');
const SKIPPED = fixture('skipped.ics');
const LINK = 'https://calendar.example.com/private-abc123/basic.ics';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Monday 12 October 2026, 07:59 in London (BST). */
const MON_12 = Date.parse('2026-10-12T06:59:00Z');

describe('parseMeetings', () => {
  it('skips a weekly meeting on its EXDATE', () => {
    expect(parseMeetings(WEEKLY, MON_12, 'Europe/London')).toEqual([]);
  });

  it('uses the moved instance: its own time and title', () => {
    const meetings = parseMeetings(WEEKLY, MON_12 + 7 * 24 * HOUR, 'Europe/London');
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({
      title: 'Design review (moved)',
      start: Date.parse('2026-10-19T13:00:00Z'),
      end: Date.parse('2026-10-19T13:45:00Z'),
    });
  });

  it('keeps the wall time across the change from summer time', () => {
    const before = parseMeetings(WEEKLY, Date.parse('2026-10-04T23:00:00Z'), 'Europe/London');
    expect(before[0]?.start).toBe(Date.parse('2026-10-05T09:00:00Z'));
    const after = parseMeetings(WEEKLY, Date.parse('2026-10-25T23:00:00Z'), 'Europe/London');
    expect(after[0]).toMatchObject({
      title: 'Design review',
      start: Date.parse('2026-10-26T10:00:00Z'),
      attendees: ['Priya Shah', 'Sam Lee'],
      where: 'https://meet.example.com/abc-defg',
      description: 'Agenda: the onboarding flow.\nNotes from last week are in Notion.',
    });
  });

  it('skips all-day, cancelled and solo events, and anything past the next 36 hours', () => {
    const meetings = parseMeetings(SKIPPED, MON_12, 'Europe/London');
    expect(meetings.map((m) => m.title)).toEqual(['Read the RFC before Thursday']);
  });

  it('caps a long description at 600 characters', () => {
    const long = WEEKLY.replace(
      'DESCRIPTION:Agenda: the onboarding flow.\\nNotes from last week are in Notion.',
      `DESCRIPTION:${'x'.repeat(2_000)}`,
    );
    const [meeting] = parseMeetings(long, Date.parse('2026-10-25T23:00:00Z'), 'Europe/London');
    expect(meeting?.description?.length).toBe(600);
  });

  it('returns nothing for text that is not a calendar', () => {
    expect(() => parseMeetings('<html>Sign in</html>', MON_12, 'Europe/London')).toThrow();
  });
});

function feedWith(fetchText: FetchText, start = MON_12 - 4 * HOUR) {
  const secrets = new InMemorySecretStore();
  let now = start;
  const feed = new CalendarFeed({
    secrets,
    fetchText,
    clock: { now: () => now },
    timeZone: () => 'Europe/London',
  });
  return {
    feed,
    secrets,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('CalendarFeed', () => {
  it('reads the link from the keychain and fetches it, at most once every 15 minutes', async () => {
    const urls: string[] = [];
    const t = feedWith((url) => {
      urls.push(url);
      return Promise.resolve(SKIPPED);
    });
    await t.secrets.set(CALENDAR_SECRET, LINK);
    expect((await t.feed.upcoming()).map((m) => m.title)).toEqual(['Read the RFC before Thursday']);
    t.advance(FEED_REFRESH_MS - 1);
    await t.feed.upcoming();
    expect(urls).toEqual([LINK]);
    t.advance(1);
    await t.feed.upcoming();
    expect(urls).toHaveLength(2);
    expect(t.feed.problem()).toBeNull();
  });

  it('does nothing without a link, and says so', async () => {
    const t = feedWith(() => Promise.reject(new Error('never called')));
    expect(await t.feed.upcoming()).toEqual([]);
    expect(t.feed.problem()).toMatch(/no calendar link/i);
  });

  it('keeps the last good list when the host answers 404 or times out, and says so plainly', async () => {
    let answer: () => Promise<string> = () => Promise.resolve(SKIPPED);
    const t = feedWith(() => answer());
    await t.secrets.set(CALENDAR_SECRET, LINK);
    await t.feed.upcoming();
    answer = () => Promise.reject(new CalendarFetchError('the calendar host answered 404'));
    t.advance(FEED_REFRESH_MS);
    expect(await t.feed.upcoming()).toHaveLength(1);
    expect(t.feed.problem()).toBe('Could not read your calendar: the calendar host answered 404.');
    expect(t.feed.problem()).not.toContain(LINK);

    answer = () => Promise.reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    t.advance(FEED_REFRESH_MS);
    expect(await t.feed.upcoming()).toHaveLength(1);
    expect(t.feed.problem()).toMatch(/did not answer in 10 seconds/);
  });

  it('passes a time limit to the fetch', async () => {
    let signal: AbortSignal | undefined;
    const t = feedWith((_url, options) => {
      signal = options.signal;
      return Promise.resolve(SKIPPED);
    });
    await t.secrets.set(CALENDAR_SECRET, LINK);
    await t.feed.upcoming();
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses an http link and a calendar over 2 MB', async () => {
    const urls: string[] = [];
    let body = SKIPPED;
    const t = feedWith((url) => {
      urls.push(url);
      return Promise.resolve(body);
    });
    await t.secrets.set(CALENDAR_SECRET, 'http://calendar.example.com/a.ics');
    expect(await t.feed.upcoming()).toEqual([]);
    expect(urls).toEqual([]);
    expect(t.feed.problem()).toMatch(/https/);

    await t.feed.setLink(LINK);
    body = 'x'.repeat(FEED_MAX_BYTES + 1);
    expect(await t.feed.upcoming()).toEqual([]);
    expect(t.feed.problem()).toMatch(/over 2 MB/);
  });

  it('keeps a new link in the keychain and fetches it at once; null forgets it', async () => {
    const urls: string[] = [];
    const t = feedWith((url) => {
      urls.push(url);
      return Promise.resolve(SKIPPED);
    });
    await t.feed.upcoming();
    await t.feed.setLink(LINK);
    expect(await t.secrets.get(CALENDAR_SECRET)).toBe(LINK);
    expect(await t.feed.upcoming()).toHaveLength(1);
    expect(urls).toEqual([LINK]);
    await t.feed.setLink(null);
    expect(await t.secrets.get(CALENDAR_SECRET)).toBeNull();
    expect(t.feed.cached()).toEqual([]);
  });

  it('drops meetings that have ended from what it hands out', async () => {
    const t = feedWith(() => Promise.resolve(SKIPPED));
    await t.secrets.set(CALENDAR_SECRET, LINK);
    await t.feed.upcoming();
    t.advance(12 * HOUR);
    expect(t.feed.cached()).toEqual([]);
  });
});

describe('httpsFetchText', () => {
  const signal = new AbortController().signal;

  it('returns the body of an https answer', async () => {
    const read = httpsFetchText(() => Promise.resolve(new Response(SKIPPED)));
    expect(await read(LINK, { signal, maxBytes: FEED_MAX_BYTES })).toBe(SKIPPED);
  });

  it('refuses an http link, an error status and a body over the cap', async () => {
    const ok = httpsFetchText(() => Promise.resolve(new Response('x'.repeat(100))));
    await expect(ok('http://a.example/x.ics', { signal, maxBytes: 1_000 })).rejects.toThrow(
      /https/,
    );
    await expect(ok(LINK, { signal, maxBytes: 10 })).rejects.toThrow(/over 2 MB/);
    const missing = httpsFetchText(() => Promise.resolve(new Response('gone', { status: 404 })));
    await expect(missing(LINK, { signal, maxBytes: 1_000 })).rejects.toThrow(
      'the calendar host answered 404',
    );
  });
});
