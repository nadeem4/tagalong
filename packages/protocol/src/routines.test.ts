import { describe, expect, it } from 'vitest';
import { coreToHostNotifications, hostToCoreMethods } from './methods';
import {
  CalendarCheckResult,
  CalendarSetLinkParams,
  Routine,
  RoutineDraft,
  describeDeliver,
  describeWhen,
} from './routines';

const BASE = {
  id: '6f1c2f4e-8a7b-4c1d-9e2f-3a4b5c6d7e8f',
  name: 'Morning papers',
  when: { type: 'schedule', days: [1, 2, 3, 4, 5], time: '08:00' },
  what: 'Find new papers on my topics.',
  createdAt: '2026-10-13T07:00:00.000Z',
};

describe('Routine', () => {
  it('fills the defaults: on, bubble only, no hand-off, nothing it uses', () => {
    const routine = Routine.parse(BASE);
    expect(routine.enabled).toBe(true);
    expect(routine.topics).toBe('');
    expect(routine.deliver).toEqual({ bubble: true, voice: false, notification: false });
    expect(routine.handTo).toBeUndefined();
    expect(routine.uses).toEqual([]);
  });

  it('takes each trigger in the set and nothing else', () => {
    for (const when of [
      { type: 'launch' },
      { type: 'app', match: 'Outlook' },
      { type: 'expert' },
      { type: 'watch' },
      { type: 'meeting', minutesBefore: 10 },
    ]) {
      expect(Routine.safeParse({ ...BASE, when }).success).toBe(true);
    }
    expect(Routine.safeParse({ ...BASE, when: { type: 'cron', expr: '* * * * *' } }).success).toBe(
      false,
    );
  });

  it('refuses a schedule with no days, a bad time, or an empty app match', () => {
    const bad = [
      { type: 'schedule', days: [], time: '08:00' },
      { type: 'schedule', days: [1], time: '8am' },
      { type: 'schedule', days: [1], time: '24:00' },
      { type: 'schedule', days: [7], time: '08:00' },
      { type: 'app', match: '  ' },
      { type: 'meeting', minutesBefore: 4 },
      { type: 'meeting', minutesBefore: 61 },
      { type: 'meeting', minutesBefore: 7.5 },
    ];
    for (const when of bad) expect(Routine.safeParse({ ...BASE, when }).success).toBe(false);
  });

  it('a draft is a routine without its id and date, for the card and the form', () => {
    const { id: _id, createdAt: _at, ...draft } = BASE;
    expect(RoutineDraft.parse(draft).name).toBe('Morning papers');
  });
});

describe('describeWhen', () => {
  const at = (days: number[], time = '08:00') => describeWhen({ type: 'schedule', days, time });

  it('says every day, weekdays, weekends, or the days by name', () => {
    expect(at([0, 1, 2, 3, 4, 5, 6])).toBe('Every day at 08:00');
    expect(at([1, 2, 3, 4, 5])).toBe('Weekdays at 08:00');
    expect(at([0, 6], '10:30')).toBe('Weekends at 10:30');
    expect(at([1, 3])).toBe('Mon, Wed at 08:00');
  });

  it('says each trigger plainly', () => {
    expect(describeWhen({ type: 'launch' })).toBe('When Tagalong opens');
    expect(describeWhen({ type: 'app', match: 'Outlook' })).toBe('When Outlook appears');
    expect(describeWhen({ type: 'expert' })).toBe('When an expert finishes');
    expect(describeWhen({ type: 'watch' })).toBe('When a watch fires');
    expect(describeWhen({ type: 'meeting', minutesBefore: 10 })).toBe('10 min before each meeting');
  });
});

describe('describeDeliver', () => {
  it('lists where the result goes, Activity always last', () => {
    expect(describeDeliver({ bubble: true, voice: true, notification: false })).toBe(
      'Bubble, voice, Activity',
    );
    expect(describeDeliver({ bubble: false, voice: false, notification: true })).toBe(
      'Windows notification, Activity',
    );
  });
});

describe('the calendar link', () => {
  it('takes an https link, or null to forget it, and nothing else', () => {
    expect(
      CalendarSetLinkParams.safeParse({ link: 'https://calendar.google.com/x/basic.ics' }).success,
    ).toBe(true);
    expect(CalendarSetLinkParams.safeParse({ link: null }).success).toBe(true);
    expect(CalendarSetLinkParams.safeParse({ link: 'http://example.com/a.ics' }).success).toBe(
      false,
    );
    expect(CalendarSetLinkParams.safeParse({ link: 'not a link' }).success).toBe(false);
  });

  it('a check says whether a link is kept, never the link itself', () => {
    const shape = Object.keys(CalendarCheckResult.shape).sort();
    expect(shape).toEqual(['error', 'linked', 'meetings']);
  });
});

describe('the routine methods', () => {
  it('are catalogued', () => {
    for (const method of [
      'routines.list',
      'routines.save',
      'routines.delete',
      'routines.setEnabled',
      'routines.runNow',
      'routines.confirm',
      'routines.dismiss',
      'calendar.setLink',
      'calendar.check',
    ]) {
      expect(Object.keys(hostToCoreMethods)).toContain(method);
    }
    expect(Object.keys(coreToHostNotifications)).toEqual(
      expect.arrayContaining(['routine.proposed', 'routine.result', 'routines.changed']),
    );
  });
});
