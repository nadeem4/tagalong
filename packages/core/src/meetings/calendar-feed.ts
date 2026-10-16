/**
 * Meeting prep's calendar: the person's secret .ics link, read every 15 minutes at most and
 * parsed by code, so finding "10 minutes before" never costs a model turn. The link is a
 * credential: it lives in the keychain under `calendar.ics` and is never logged, shown,
 * stored in settings or put in an error message. Contains CalendarFeed, parseMeetings and
 * httpsFetchText.
 */
import ICAL from 'ical.js';
import type { CalendarCheckResult } from '@tagalong/protocol';
import { zonedToEpoch } from '../routines/schedule';
import type { SecretStore } from '../settings/settings';

/** Where the link is filed in the host's SecretStore. */
export const CALENDAR_SECRET = 'calendar.ics';
export const FEED_REFRESH_MS = 15 * 60_000;
export const FEED_TIMEOUT_MS = 10_000;
export const FEED_MAX_BYTES = 2 * 1024 * 1024;
/** How far ahead it keeps meetings. */
export const FEED_HORIZON_MS = 36 * 60 * 60_000;
/** How much of an invite's description rides into the prep. */
export const DESCRIPTION_CHARS = 600;

/** A timed meeting with someone, one occurrence of it. Times in epoch ms. */
export interface Meeting {
  /** The event's UID and this occurrence's start. */
  id: string;
  title: string;
  start: number;
  end: number;
  /** Names, or addresses when an invite gives no name. */
  attendees: string[];
  /** Its room or its call link. */
  where?: string;
  description?: string;
}

/** Fetches the link's text. The feed passes a time limit and the size cap. */
export type FetchText = (
  url: string,
  options: { signal: AbortSignal; maxBytes: number },
) => Promise<string>;

/** A reason the calendar could not be read, safe to show: it never holds the link. */
export class CalendarFetchError extends Error {}

const OVER_CAP = 'it is over 2 MB';
const NOT_HTTPS = 'the link must start with https://';

/** The real fetch: https only, a capped body, and errors that never name the link. */
export function httpsFetchText(fetchImpl: typeof fetch = fetch): FetchText {
  return async (url, { signal, maxBytes }) => {
    if (!url.startsWith('https://')) throw new CalendarFetchError(NOT_HTTPS);
    const response = await fetchImpl(url, { signal, headers: { accept: 'text/calendar' } });
    if (response.url !== '' && !response.url.startsWith('https://')) {
      throw new CalendarFetchError('the calendar host sent it over plain http');
    }
    if (!response.ok) throw new CalendarFetchError(`the calendar host answered ${response.status}`);
    const reader = response.body?.getReader();
    if (reader === undefined) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new CalendarFetchError(OVER_CAP);
      }
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  };
}

const MAX_STEPS = 10_000;
const DAY_MS = 86_400_000;

function clip(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, chars - 1)}…` : text;
}

/** An ical.js time as an instant: its own zone when the feed defined it, else the person's. */
function toEpoch(time: ICAL.Time, fallbackZone: string): number {
  if (time.zone !== undefined && time.zone.tzid !== 'floating') return time.toUnixTime() * 1000;
  const wall = {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.hour,
    minute: time.minute,
  };
  const named = (time as { timezone?: string }).timezone;
  try {
    return zonedToEpoch(wall, named ?? fallbackZone);
  } catch {
    return zonedToEpoch(wall, fallbackZone);
  }
}

function personOf(value: string): string {
  return value
    .replace(/^mailto:/i, '')
    .trim()
    .toLowerCase();
}

function meetingOf(
  item: ICAL.Event,
  startTime: ICAL.Time,
  endTime: ICAL.Time,
  zone: string,
): Meeting | null {
  if (startTime.isDate) return null;
  const status = item.component.getFirstPropertyValue('status');
  if (typeof status === 'string' && status.toUpperCase() === 'CANCELLED') return null;
  const people = new Set<string>();
  const attendees: string[] = [];
  for (const property of item.attendees) {
    const address = String(property.getFirstValue() ?? '');
    const name = property.getParameter('cn');
    people.add(personOf(address));
    attendees.push(
      typeof name === 'string' && name.trim() !== '' ? name.trim() : personOf(address),
    );
  }
  if (item.organizer) people.add(personOf(item.organizer));
  people.delete('');
  const description = (item.description ?? '').trim();
  // A focus block: nobody else, nothing to read.
  if (people.size < 2 && description === '') return null;
  const start = toEpoch(startTime, zone);
  const end = toEpoch(endTime, zone);
  const url = item.component.getFirstPropertyValue('url');
  const where = (item.location ?? '').trim() || (typeof url === 'string' ? url.trim() : '');
  return {
    id: `${item.uid}/${start}`,
    title: (item.summary ?? '').trim() || 'A meeting',
    start,
    end: end > start ? end : start,
    attendees,
    ...(where !== '' ? { where } : {}),
    ...(description !== '' ? { description: clip(description, DESCRIPTION_CHARS) } : {}),
  };
}

/**
 * The timed meetings with someone that are on, or still to come, in the 36 hours after
 * `now`: recurrences expanded (RRULE, EXDATE, moved instances), all-day, cancelled and solo
 * events left out. Throws when the text is not a calendar.
 */
export function parseMeetings(ics: string, now: number, timeZone: string): Meeting[] {
  const root = new ICAL.Component(ICAL.parse(ics) as unknown[]);
  if (root.name !== 'vcalendar')
    throw new CalendarFetchError('that link did not return a calendar');
  const horizon = now + FEED_HORIZON_MS;
  const masters = new Map<string, ICAL.Event>();
  const loose: ICAL.Event[] = [];
  const events = root.getAllSubcomponents('vevent').map((vevent) => new ICAL.Event(vevent));
  for (const event of events) {
    if (!event.isRecurrenceException()) masters.set(event.uid, event);
  }
  for (const event of events) {
    if (!event.isRecurrenceException()) continue;
    const master = masters.get(event.uid);
    if (master !== undefined) master.relateException(event);
    else loose.push(event);
  }
  const found: Meeting[] = [];
  const keep = (meeting: Meeting | null) => {
    if (meeting !== null && meeting.start < horizon && meeting.end > now) found.push(meeting);
  };
  for (const event of [...masters.values(), ...loose]) {
    if (!event.isRecurring()) {
      keep(meetingOf(event, event.startDate, event.endDate ?? event.startDate, timeZone));
      continue;
    }
    const iterator = event.iterator();
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const next = iterator.next();
      if (!next) break;
      // A moved instance can land up to a day from where its rule puts it.
      if (toEpoch(next, timeZone) > horizon + DAY_MS) break;
      const details = event.getOccurrenceDetails(next);
      keep(meetingOf(details.item, details.startDate, details.endDate, timeZone));
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export interface CalendarFeedOptions {
  secrets: SecretStore;
  fetchText: FetchText;
  clock: { now(): number };
  /** The person's zone, for times an invite gives without one. */
  timeZone: () => string;
}

/**
 * The person's calendar, as the meetings coming up. Reads the link from the keychain and
 * fetches it at most once every 15 minutes; a fetch that fails keeps the last good list
 * and says why, plainly, for the routine's row in Home.
 */
export class CalendarFeed {
  readonly #options: CalendarFeedOptions;
  #meetings: Meeting[] = [];
  #triedAt: number | null = null;
  #problem: string | null = null;
  #inFlight: Promise<void> | null = null;

  constructor(options: CalendarFeedOptions) {
    this.#options = options;
  }

  /** The meetings on or to come, fetching first when the last try is 15 minutes old. */
  async upcoming(): Promise<Meeting[]> {
    const now = this.#options.clock.now();
    if (this.#triedAt === null || now - this.#triedAt >= FEED_REFRESH_MS) {
      this.#inFlight ??= this.#refresh().finally(() => {
        this.#inFlight = null;
      });
      await this.#inFlight;
    }
    return this.cached();
  }

  /** The last good list, without fetching; meetings that have ended are left out. */
  cached(): Meeting[] {
    const now = this.#options.clock.now();
    return this.#meetings.filter((meeting) => meeting.end > now);
  }

  /** Why the calendar cannot be read, or null. */
  problem(): string | null {
    return this.#problem;
  }

  /** Keeps a new link in the keychain (null forgets it); the next read fetches at once. */
  async setLink(link: string | null): Promise<void> {
    if (link === null) await this.#options.secrets.delete(CALENDAR_SECRET);
    else await this.#options.secrets.set(CALENDAR_SECRET, link);
    this.#meetings = [];
    this.#triedAt = null;
    this.#problem = null;
  }

  /** Whether a link is kept and how many meetings it holds; never the link. */
  async check(): Promise<CalendarCheckResult> {
    const meetings = await this.upcoming();
    if ((await this.#options.secrets.get(CALENDAR_SECRET)) === null) {
      return { linked: false, meetings: 0 };
    }
    return {
      linked: true,
      meetings: meetings.length,
      ...(this.#problem !== null ? { error: this.#problem } : {}),
    };
  }

  async #refresh(): Promise<void> {
    const now = this.#options.clock.now();
    this.#triedAt = now;
    const link = await this.#options.secrets.get(CALENDAR_SECRET);
    if (link === null) {
      this.#meetings = [];
      this.#problem = 'No calendar link yet: paste one in the Meeting prep routine in Home.';
      return;
    }
    try {
      if (!link.startsWith('https://')) throw new CalendarFetchError(NOT_HTTPS);
      const text = await this.#options.fetchText(link, {
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        maxBytes: FEED_MAX_BYTES,
      });
      if (text.length > FEED_MAX_BYTES) throw new CalendarFetchError(OVER_CAP);
      this.#meetings = parseMeetings(text, now, this.#options.timeZone());
      this.#problem = null;
    } catch (error) {
      this.#problem = `Could not read your calendar: ${reasonOf(error)}.`;
    }
  }
}

/** A failure in words that never hold the link: only reasons this module wrote. */
function reasonOf(error: unknown): string {
  if (error instanceof CalendarFetchError) return error.message;
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return 'the calendar host did not answer in 10 seconds';
  }
  if (error instanceof Error && /invalid|parse|line/i.test(error.message)) {
    return 'that link did not return a calendar';
  }
  return 'the calendar host could not be reached';
}
