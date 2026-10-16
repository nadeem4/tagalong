/**
 * Schedule math for routines, in the person's own time zone. Pure: every function takes the
 * instant and the zone, so tests pin both and the engine passes the system's.
 *
 * A schedule is days of the week and a wall-clock time. A time the clocks skip in spring runs
 * that much later (01:30 becomes 02:30); a time they repeat in autumn runs once, the first time.
 *
 * Contains `latestDue`, `nextDue`, `dueSlot`, `zonedToEpoch`, `wallTimeAt`, and the meeting
 * helpers `dueMeetings` and `nextMeetingRun`.
 */

/** The schedule half of a routine's "when": days (0 is Sunday) and an HH:MM time. */
interface Schedule {
  readonly days: readonly number[];
  readonly time: string;
}

export interface WallTime {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, found);
  }
  return found;
}

/** The wall time at an instant, in the zone. */
export function wallTimeAt(epochMs: number, timeZone: string): WallTime & { second: number } {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts['year'] ?? 1970,
    month: parts['month'] ?? 1,
    day: parts['day'] ?? 1,
    hour: parts['hour'] ?? 0,
    minute: parts['minute'] ?? 0,
    second: parts['second'] ?? 0,
  };
}

/** Minutes the zone is ahead of UTC at an instant. */
function offsetAt(epochMs: number, timeZone: string): number {
  const wall = wallTimeAt(epochMs, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60_000);
}

function sameWall(epochMs: number, wall: WallTime, timeZone: string): boolean {
  const seen = wallTimeAt(epochMs, timeZone);
  return (
    seen.year === wall.year &&
    seen.month === wall.month &&
    seen.day === wall.day &&
    seen.hour === wall.hour &&
    seen.minute === wall.minute
  );
}

/** The instant a wall time happens in the zone: the first of two, or later by a skipped gap. */
export function zonedToEpoch(wall: WallTime, timeZone: string): number {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // The offsets a day either side cover both sides of any clock change near this time.
  const before = offsetAt(naive - DAY_MS, timeZone);
  const after = offsetAt(naive + DAY_MS, timeZone);
  const candidates = [naive - before * 60_000, naive - after * 60_000]
    .filter((epoch) => sameWall(epoch, wall, timeZone))
    .sort((a, b) => a - b);
  return candidates[0] ?? naive - before * 60_000;
}

/** The calendar date `offsetDays` from the zone's date at `epochMs`, with its weekday. */
function dateFrom(epochMs: number, offsetDays: number, timeZone: string) {
  const wall = wallTimeAt(epochMs, timeZone);
  const date = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + offsetDays));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

function slotOn(schedule: Schedule, date: ReturnType<typeof dateFrom>, timeZone: string) {
  if (!schedule.days.includes(date.weekday)) return null;
  const [hour, minute] = schedule.time.split(':').map(Number);
  return zonedToEpoch({ ...date, hour: hour ?? 0, minute: minute ?? 0 }, timeZone);
}

/** The latest slot at or before `now`, looking back a week. */
export function latestDue(schedule: Schedule, now: number, timeZone: string): number | null {
  for (let back = 0; back <= 7; back += 1) {
    const slot = slotOn(schedule, dateFrom(now, -back, timeZone), timeZone);
    if (slot !== null && slot <= now) return slot;
  }
  return null;
}

/** The first slot after `after`, looking ahead a week. */
export function nextDue(schedule: Schedule, after: number, timeZone: string): number | null {
  for (let ahead = 0; ahead <= 8; ahead += 1) {
    const slot = slotOn(schedule, dateFrom(after, ahead, timeZone), timeZone);
    if (slot !== null && slot > after) return slot;
  }
  return null;
}

/**
 * The slot to run now, or null. Only the latest slot since the last one handled: a PC that
 * slept through three mornings runs the routine once, not three times.
 */
export function dueSlot(
  schedule: Schedule,
  lastHandled: number,
  now: number,
  timeZone: string,
): number | null {
  const latest = latestDue(schedule, now, timeZone);
  return latest !== null && latest > lastHandled ? latest : null;
}

/** A meeting's start, the one thing meeting routines time against. Epoch ms. */
interface Timed {
  readonly start: number;
}

/**
 * The meetings a "minutes before" routine is due for now: inside their lead time, not yet
 * started, and later than the last meeting it ran for. Meetings that start together are
 * due together, so they share one run.
 */
export function dueMeetings<T extends Timed>(
  meetings: readonly T[],
  minutesBefore: number,
  lastHandled: number,
  now: number,
): T[] {
  const lead = minutesBefore * 60_000;
  return meetings.filter((m) => m.start - lead <= now && now < m.start && m.start > lastHandled);
}

/** When a "minutes before" routine runs next, from the meetings known, or null. */
export function nextMeetingRun(
  meetings: readonly Timed[],
  minutesBefore: number,
  lastHandled: number,
  now: number,
): number | null {
  const starts = meetings
    .map((m) => m.start)
    .filter((start) => start > now && start > lastHandled)
    .sort((a, b) => a - b);
  return starts[0] === undefined ? null : Math.max(starts[0] - minutesBefore * 60_000, now);
}
