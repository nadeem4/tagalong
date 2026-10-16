/** Tests for Wellbeing: stretches, late nights, calls, Not now and clock jumps. */
import { describe, expect, it } from 'vitest';
import { Expert, Settings } from '@tagalong/protocol';
import type { Brief, Pet, PetMoodParams, PetRemarkParams, WindowEntry } from '@tagalong/protocol';
import {
  BREAK_MS,
  LATE_ACTIVE_MS,
  LATE_LINE,
  NOT_NOW_MS,
  STRETCH_LINE,
  STRETCH_MS,
  WRITE_UP_ASK,
  Wellbeing,
} from './wellbeing';

const MINUTE = 60_000;

const scout: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  model: 'claude-opus-5',
  providerId: 'anthropic',
  roleId: 'companion',
  toolGrants: {},
  replyStyle: 'text',
};

const claudeCode = Expert.parse({
  id: 'claude-code',
  name: 'Claude Code',
  connection: { type: 'claude-code' },
});

function win(title: string, extra: Partial<WindowEntry> = {}): WindowEntry {
  return {
    id: 'w-1',
    processName: 'Code.exe',
    title,
    state: 'foreground',
    browser: false,
    ...extra,
  };
}

const editor = [win('parser.ts - tagalong')];

function setup(options: { enabled?: boolean; hour?: number; experts?: Expert[] } = {}) {
  const clock = { t: 0, now: () => clock.t };
  const time = { hour: options.hour ?? 14 };
  const settings = Settings.parse({ wellbeing: { enabled: options.enabled ?? true } });
  const remarks: PetRemarkParams[] = [];
  const moods: PetMoodParams['mood'][] = [];
  const proposals: Array<{ expertId: string; petId: string; brief: Brief }> = [];
  const wellbeing = new Wellbeing({
    clock,
    hourOf: () => time.hour,
    settings: () => settings,
    pet: () => scout,
    experts: () => options.experts ?? [],
    propose: (params) => proposals.push(params),
    emit: (event) => {
      if (event.method === 'pet.remark') remarks.push(event.params);
      else moods.push(event.params.mood);
    },
  });
  /** One host tick per minute from now until `minutes` from the start, all active. */
  const tickUntil = (minutes: number, windows: WindowEntry[] = editor, idleMs = 0): void => {
    while (clock.t < minutes * MINUTE) {
      clock.t += MINUTE;
      wellbeing.observe({ idleMs, windows });
    }
  };
  const tick = (windows: WindowEntry[] = editor, idleMs = 0): void => {
    clock.t += MINUTE;
    wellbeing.observe({ idleMs, windows });
  };
  return { clock, time, settings, remarks, moods, proposals, wellbeing, tickUntil, tick };
}

describe('Wellbeing: the long stretch', () => {
  it('says nothing before 90 minutes, then looks tired and says the stretch line once', () => {
    const { remarks, moods, tickUntil, wellbeing } = setup();
    wellbeing.observe({ idleMs: 0, windows: editor });
    tickUntil(STRETCH_MS / MINUTE - 1);
    expect(remarks).toEqual([]);
    expect(moods).toEqual([]);
    tickUntil(STRETCH_MS / MINUTE);
    expect(moods).toEqual(['tired']);
    expect(remarks).toHaveLength(1);
    expect(remarks[0]).toMatchObject({ petId: 'scout', text: STRETCH_LINE });
    expect(remarks[0]!.offer).toBeUndefined();
    tickUntil(120);
    expect(remarks).toHaveLength(1);
    expect(moods).toEqual(['tired']);
  });

  it('a five-minute break looks rested and starts the stretch over', () => {
    const { remarks, moods, tickUntil, tick, wellbeing } = setup();
    wellbeing.observe({ idleMs: 0, windows: editor });
    tickUntil(90);
    tick(editor, BREAK_MS - 1);
    expect(moods).toEqual(['tired']);
    tick(editor, BREAK_MS);
    expect(moods).toEqual(['tired', 'rested']);
    const restartedAt = 92;
    tickUntil(restartedAt + 89);
    expect(remarks).toHaveLength(1);
    tickUntil(restartedAt + 91);
    expect(remarks).toHaveLength(2);
    expect(moods).toEqual(['tired', 'rested', 'tired']);
  });
});

describe('Wellbeing: late at night', () => {
  it('after 23:00 and 30 minutes active, says the late line with the offer when an expert is on', () => {
    const { remarks, moods, tickUntil, wellbeing } = setup({ hour: 23, experts: [claudeCode] });
    wellbeing.observe({ idleMs: 0, windows: editor });
    tickUntil(LATE_ACTIVE_MS / MINUTE - 1);
    expect(remarks).toEqual([]);
    tickUntil(LATE_ACTIVE_MS / MINUTE);
    expect(moods).toEqual(['tired']);
    expect(remarks).toHaveLength(1);
    expect(remarks[0]).toMatchObject({ text: LATE_LINE, offer: WRITE_UP_ASK });
  });

  it('says it without the offer when no expert is switched on', () => {
    const off = Expert.parse({ ...claudeCode, enabled: false });
    const { remarks, tickUntil, wellbeing } = setup({ hour: 1, experts: [off] });
    wellbeing.observe({ idleMs: 0, windows: editor });
    tickUntil(30);
    expect(remarks).toHaveLength(1);
    expect(remarks[0]!.text).toBe(LATE_LINE);
    expect(remarks[0]!.offer).toBeUndefined();
  });

  it('says it once a night, even after a break', () => {
    const { remarks, tickUntil, tick, wellbeing } = setup({ hour: 23 });
    wellbeing.observe({ idleMs: 0, windows: editor });
    tickUntil(30);
    tick(editor, BREAK_MS);
    tickUntil(120);
    expect(remarks.filter((remark) => remark.text === LATE_LINE)).toHaveLength(1);
  });

  it('clears the tired face at 05:00', () => {
    const { moods, time, tickUntil, tick, wellbeing } = setup({ hour: 4 });
    wellbeing.observe({ idleMs: 0, windows: editor });
    tickUntil(30);
    expect(moods).toEqual(['tired']);
    time.hour = 5;
    tick();
    expect(moods).toEqual(['tired', 'rested']);
  });

  it('says nothing during the day after 30 minutes', () => {
    const { remarks, moods, tickUntil, wellbeing } = setup({ hour: 22 });
    wellbeing.observe({ idleMs: 0, windows: editor });
    tickUntil(60);
    expect(remarks).toEqual([]);
    expect(moods).toEqual([]);
  });
});

describe('Wellbeing: calls and full screen', () => {
  const teams = [win('Standup | Microsoft Teams', { processName: 'ms-teams.exe' })];
  const meet = [win('Meet - abc-defg-hij', { processName: 'chrome.exe', browser: true })];
  const fullScreen = [win('Movie', { fullScreen: true })];

  it.each([
    ['a Teams window', teams],
    ['a Meet tab', meet],
    ['a full-screen window', fullScreen],
  ])('holds the line and the face while %s is in front, and gives them after', (_, front) => {
    const { remarks, moods, tickUntil, tick, wellbeing } = setup();
    wellbeing.observe({ idleMs: 0, windows: editor });
    tickUntil(89);
    tickUntil(100, front);
    expect(remarks).toEqual([]);
    expect(moods).toEqual([]);
    tick();
    expect(moods).toEqual(['tired']);
    expect(remarks).toHaveLength(1);
  });

  it('still counts the time on a call as part of the stretch', () => {
    const { remarks, tickUntil, tick, wellbeing } = setup();
    wellbeing.observe({ idleMs: 0, windows: editor });
    tickUntil(100, teams);
    tick();
    expect(remarks).toHaveLength(1);
  });
});

describe('Wellbeing: Not now, off, and the offer', () => {
  it('Not now keeps it quiet for an hour', () => {
    const { remarks, clock, tickUntil, wellbeing } = setup({ hour: 23 });
    wellbeing.observe({ idleMs: 0, windows: editor });
    tickUntil(29);
    wellbeing.notNow();
    const quietEnds = clock.t + NOT_NOW_MS;
    tickUntil(quietEnds / MINUTE - 1);
    expect(remarks).toEqual([]);
    tickUntil(quietEnds / MINUTE);
    expect(remarks).toHaveLength(1);
    expect(remarks[0]!.text).toBe(LATE_LINE);
  });

  it('does nothing at all while switched off', () => {
    const { remarks, moods, tickUntil, wellbeing } = setup({ enabled: false, hour: 23 });
    wellbeing.observe({ idleMs: 0, windows: editor });
    tickUntil(200);
    expect(remarks).toEqual([]);
    expect(moods).toEqual([]);
  });

  it('switched off while tired, it looks rested once', () => {
    const { moods, settings, tickUntil, wellbeing } = setup();
    wellbeing.observe({ idleMs: 0, windows: editor });
    tickUntil(90);
    settings.wellbeing = { enabled: false };
    wellbeing.settle();
    wellbeing.settle();
    expect(moods).toEqual(['tired', 'rested']);
  });

  it('accepting the late offer proposes the write-up brief to the first enabled expert', () => {
    const second = Expert.parse({ ...claudeCode, id: 'other' });
    const { remarks, proposals, tickUntil, wellbeing } = setup({
      hour: 23,
      experts: [claudeCode, second],
    });
    wellbeing.observe({ idleMs: 0, windows: editor });
    tickUntil(30);
    expect(wellbeing.accept('not-this-one')).toBe(false);
    expect(wellbeing.accept(remarks[0]!.remarkId)).toBe(true);
    expect(proposals).toEqual([
      {
        expertId: 'claude-code',
        petId: 'scout',
        brief: {
          ask: WRITE_UP_ASK,
          context: { app: 'Code', windowTitle: 'parser.ts - tagalong' },
        },
      },
    ]);
    expect(wellbeing.accept(remarks[0]!.remarkId)).toBe(false);
  });

  it('never puts a blind spot’s title in the brief', () => {
    const { remarks, proposals, tick, tickUntil, wellbeing } = setup({
      hour: 23,
      experts: [claudeCode],
    });
    const vault = [win('Vault', { processName: '1Password.exe' })];
    wellbeing.observe({ idleMs: 0, windows: vault });
    tickUntil(29, vault);
    tick(vault);
    expect(wellbeing.accept(remarks[0]!.remarkId)).toBe(true);
    expect(proposals[0]!.brief).toEqual({ ask: WRITE_UP_ASK });
  });

  it('a stretch line has no offer to accept', () => {
    const { remarks, proposals, tickUntil, wellbeing } = setup({ experts: [claudeCode] });
    wellbeing.observe({ idleMs: 0, windows: editor });
    tickUntil(90);
    expect(wellbeing.accept(remarks[0]!.remarkId)).toBe(false);
    expect(proposals).toEqual([]);
  });

  it('says nothing with no pet to say it', () => {
    const remarks: unknown[] = [];
    const clock = { t: 0, now: () => clock.t };
    const wellbeing = new Wellbeing({
      clock,
      hourOf: () => 14,
      settings: () => Settings.parse({ wellbeing: { enabled: true } }),
      pet: () => null,
      experts: () => [],
      propose: () => undefined,
      emit: (event) => remarks.push(event),
    });
    for (let minute = 0; minute <= 100; minute += 1) {
      clock.t = minute * MINUTE;
      wellbeing.observe({ idleMs: 0, windows: editor });
    }
    expect(remarks).toEqual([]);
  });
});

describe('Wellbeing: the clock across midnight, sleep and jumps', () => {
  const HOUR = 60 * MINUTE;
  /** A fake clock whose local hour follows it: t = 0 is midnight of day one. */
  function nightSetup(startHour: number, minute = 0) {
    const clock = { t: startHour * HOUR + minute * MINUTE, now: () => clock.t };
    const remarks: PetRemarkParams[] = [];
    const moods: PetMoodParams['mood'][] = [];
    const hourShift = { value: 0 };
    const wellbeing = new Wellbeing({
      clock,
      hourOf: (now) => (Math.floor(now / HOUR) + hourShift.value) % 24,
      settings: () => Settings.parse({ wellbeing: { enabled: true } }),
      pet: () => scout,
      experts: () => [],
      propose: () => undefined,
      emit: (event) => {
        if (event.method === 'pet.remark') remarks.push(event.params);
        else moods.push(event.params.mood);
      },
    });
    const tick = (idleMs = 0): void => {
      clock.t += MINUTE;
      wellbeing.observe({ idleMs, windows: editor });
    };
    const ticks = (count: number, idleMs = 0): void => {
      for (let i = 0; i < count; i += 1) tick(idleMs);
    };
    return { clock, remarks, moods, wellbeing, tick, ticks, hourShift };
  }

  it('keeps one late line for the night across midnight, and says it again the next night', () => {
    const { clock, remarks, moods, wellbeing, tick, ticks } = nightSetup(23, 20);
    wellbeing.observe({ idleMs: 0, windows: editor });
    ticks(30); // 23:50
    expect(remarks.map((remark) => remark.text)).toEqual([LATE_LINE]);
    ticks(30); // 00:20, past midnight
    tick(BREAK_MS); // a break
    expect(moods).toEqual(['tired', 'rested']);
    ticks(40); // 01:01, half an hour active again, still late
    expect(moods).toEqual(['tired', 'rested', 'tired']);
    expect(remarks).toHaveLength(1);
    // Asleep until the next night at 23:00: the gap counts as a break.
    clock.t = (24 + 23) * HOUR;
    wellbeing.observe({ idleMs: 0, windows: editor });
    expect(moods.at(-1)).toBe('rested');
    ticks(29);
    expect(remarks).toHaveLength(1);
    ticks(1); // 23:30 the next night
    expect(remarks.map((remark) => remark.text)).toEqual([LATE_LINE, LATE_LINE]);
  });

  it('a daylight-saving change moves the hour, not the stretch: one late line, the face kept', () => {
    const { remarks, moods, wellbeing, ticks, hourShift } = nightSetup(1);
    wellbeing.observe({ idleMs: 0, windows: editor });
    ticks(30);
    expect(remarks).toHaveLength(1);
    hourShift.value = 1; // clocks go forward
    ticks(10);
    hourShift.value = 0; // and back
    ticks(10);
    expect(remarks).toHaveLength(1);
    expect(moods).toEqual(['tired']);
  });

  it('waking from sleep is a break: no stretch line on resume, and the stretch starts over', () => {
    const { clock, remarks, moods, wellbeing, ticks } = nightSetup(14);
    wellbeing.observe({ idleMs: 0, windows: editor });
    ticks(80);
    // The laptop sleeps for two hours; on wake a key press makes the idle time small.
    clock.t += 2 * HOUR;
    wellbeing.observe({ idleMs: 2_000, windows: editor });
    expect(remarks).toEqual([]);
    expect(moods).toEqual([]);
    ticks(STRETCH_MS / MINUTE - 1);
    expect(remarks).toEqual([]);
    ticks(1);
    expect(remarks.map((remark) => remark.text)).toEqual([STRETCH_LINE]);
  });

  it('waking while tired looks rested', () => {
    const { clock, moods, wellbeing, ticks } = nightSetup(14);
    wellbeing.observe({ idleMs: 0, windows: editor });
    ticks(90);
    expect(moods).toEqual(['tired']);
    clock.t += 2 * HOUR;
    wellbeing.observe({ idleMs: 0, windows: editor });
    expect(moods).toEqual(['tired', 'rested']);
  });

  it('a clock set back starts the stretch over', () => {
    const { clock, remarks, wellbeing, ticks } = nightSetup(14);
    wellbeing.observe({ idleMs: 0, windows: editor });
    ticks(80);
    clock.t -= 2 * HOUR;
    wellbeing.observe({ idleMs: 0, windows: editor });
    ticks(STRETCH_MS / MINUTE - 1);
    expect(remarks).toEqual([]);
    ticks(1);
    expect(remarks).toHaveLength(1);
  });

  it('no ticks for a while (switched off, or sight paused) and an old stretch does not count', () => {
    const { clock, remarks, wellbeing, ticks } = nightSetup(14);
    wellbeing.observe({ idleMs: 0, windows: editor });
    ticks(80);
    clock.t += 20 * MINUTE;
    ticks(15);
    expect(remarks).toEqual([]);
  });
});
