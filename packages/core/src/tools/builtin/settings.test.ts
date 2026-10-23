/** Tests for the change_settings tool and talkPatchProblem: the card and the allowlist. */
import { describe, expect, it } from 'vitest';
import {
  SETTINGS_DEFAULTS,
  Settings,
  SettingsProposedParams,
  type SettingsPatch,
} from '@tagalong/protocol';
import { FAKE_TURN_PET, fakeTurnTools } from '../fake-turn';
import { directivesIn } from '../test-support';
import type { TurnRequest } from '../registry';
import { CHANGE_SETTINGS, talkPatchProblem, type SettingsToolDeps } from './settings';

function deps(overrides: Partial<Settings> = {}) {
  const current = Settings.parse({ ...SETTINGS_DEFAULTS, ...overrides });
  const emitted: SettingsProposedParams[] = [];
  const value: SettingsToolDeps = {
    get: () => current,
    emit: (params) => emitted.push(params),
  };
  return { value, emitted, current };
}

const ROUTINE: Partial<TurnRequest> = {
  routine: { routineId: 'r', name: 'Routine', handedOff: () => undefined },
};

async function change(
  d: ReturnType<typeof deps>,
  changes: unknown,
  overrides: Partial<TurnRequest> = {},
) {
  return fakeTurnTools({ changeSettings: d.value }, overrides).run({
    name: CHANGE_SETTINGS,
    input: { changes },
  });
}

describe(CHANGE_SETTINGS, () => {
  it('shows a card with the patch and a now-and-after row per change, and saves nothing', async () => {
    const d = deps();
    const outcome = await change(d, [
      { setting: 'voice.speed', value: 0.85 },
      { setting: 'userName', value: 'Sam' },
    ]);
    expect(outcome.isError).toBeUndefined();
    expect(outcome.content).toContain('Apply');
    expect(directivesIn(outcome.content)).toEqual([]);
    expect(d.emitted).toHaveLength(1);
    const card = d.emitted[0]!;
    expect(SettingsProposedParams.parse(card)).toEqual(card);
    expect(card.petId).toBe(FAKE_TURN_PET.id);
    expect(card.patch).toEqual({
      voice: { ...SETTINGS_DEFAULTS.voice, speed: 0.85 },
      userName: 'Sam',
    });
    expect(card.rows).toEqual([
      { setting: 'voice.speed', label: 'Voice speed', from: '0.95', to: '0.85', loosens: false },
      { setting: 'userName', label: 'Your name', from: '(none)', to: 'Sam', loosens: false },
    ]);
  });

  it('keeps the other voice and hotkey fields when only one changes', async () => {
    const d = deps({
      voice: { ...SETTINGS_DEFAULTS.voice, elevenLabsVoiceId: 'v1', mouth: 'kokoro' },
    });
    await change(d, [
      { setting: 'voice.speed', value: 1.1 },
      { setting: 'voice.voice', value: 'bm_fable' },
      { setting: 'hotkeys.talk', value: 'RightShift' },
    ]);
    expect(d.emitted[0]!.patch.voice).toEqual({
      ...SETTINGS_DEFAULTS.voice,
      elevenLabsVoiceId: 'v1',
      mouth: 'kokoro',
      speed: 1.1,
      voice: 'bm_fable',
    });
    expect(d.emitted[0]!.patch.hotkeys).toEqual({
      ...SETTINGS_DEFAULTS.hotkeys,
      talk: 'RightShift',
    });
  });

  it('refuses a combo for the talk key: it is one key held alone', async () => {
    const d = deps();
    const refused = await change(d, [{ setting: 'hotkeys.talk', value: 'CommandOrControl+T' }]);
    expect(refused.isError).toBe(true);
    expect(refused.content).toContain('RightControl');
    expect(d.emitted).toEqual([]);
  });

  it('refuses an unknown setting and providerBaseUrls with one fact, with no card', async () => {
    const d = deps();
    const unknown = await change(d, [{ setting: 'enginePort', value: 9000 }]);
    expect(unknown.isError).toBe(true);
    expect(unknown.content).toContain('enginePort');
    const urls = await change(d, [{ setting: 'providerBaseUrls', value: 'https://evil.example' }]);
    expect(urls.isError).toBe(true);
    expect(urls.content).toContain('only in Settings');
    expect(urls.content).not.toContain('evil.example');
    // One plain fact for every refused name: what talk can change, and what only Settings can.
    expect(urls.content).toContain('cannot be changed by talk');
    expect(urls.content).toContain('voice.speed');
    expect(directivesIn(urls.content)).toEqual([]);
    expect(String(urls.content)).not.toMatch(/\bI\b/);
    expect(d.emitted).toEqual([]);
  });

  it.each([
    ['API key', 'openrouter api key'],
    ['token', 'anthropic token'],
    ['base URL', 'base url'],
    ['calendar link', 'calendar link'],
    ['ics', 'calendar.ics'],
    ['model', 'model'],
  ])('refuses %s and never repeats the value', async (_name, setting) => {
    const d = deps();
    const outcome = await change(d, [{ setting, value: 'sk-or-v1-abcdef0123456789abcdef' }]);
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain('only in Settings');
    expect(outcome.content).not.toContain('sk-or-v1');
    expect(directivesIn(outcome.content)).toEqual([]);
    expect(d.emitted).toEqual([]);
  });

  it('never repeats a key pasted into the setting name', async () => {
    const d = deps();
    const outcome = await change(d, [
      { setting: 'openrouter key sk-or-v1-abcdef0123456789abcdef0123456789', value: 'x' },
    ]);
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain('only in Settings');
    expect(outcome.content).not.toContain('abcdef0123456789');
    expect(d.emitted).toEqual([]);
  });

  it.each(['closedCleanly', 'lastVersion', 'userNameDeclined', 'captureExclusions.remove'])(
    'never reaches %s',
    async (setting) => {
      const d = deps();
      const outcome = await change(d, [{ setting, value: true }]);
      expect(outcome.isError).toBe(true);
      expect(d.emitted).toEqual([]);
    },
  );

  it('refuses the Seeing switch, which is not a setting, with no card', async () => {
    const d = deps();
    const outcome = await change(d, [{ setting: 'seeing', value: false }]);
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain('cannot be changed by talk');
    expect(d.emitted).toEqual([]);
  });

  it('describes its rules once, as facts', () => {
    const tool = fakeTurnTools({ changeSettings: deps().value }).definitions.find(
      (candidate) => candidate.name === CHANGE_SETTINGS,
    );
    expect(tool!.description).not.toMatch(/never say|say so|say only/i);
  });

  it('returns isError for an out-of-range speed or minutes, never a throw', async () => {
    const d = deps();
    const speed = await change(d, [{ setting: 'voice.speed', value: 3 }]);
    expect(speed.isError).toBe(true);
    const minutes = await change(d, [{ setting: 'rollingMemory.minutes', value: 500 }]);
    expect(minutes.isError).toBe(true);
    const shape = await fakeTurnTools({ changeSettings: d.value }).run({
      name: CHANGE_SETTINGS,
      input: 'nonsense',
    });
    expect(shape.isError).toBe(true);
    expect(d.emitted).toEqual([]);
  });

  it('only ever adds to the capture exclusions', async () => {
    const d = deps({ captureExclusions: { processNames: ['KeePass.exe'], titlePatterns: [] } });
    await change(d, [
      { setting: 'captureExclusions.add', value: 'Signal.exe' },
      { setting: 'captureExclusions.add', value: '*bank*' },
    ]);
    expect(d.emitted[0]!.patch.captureExclusions).toEqual({
      processNames: ['KeePass.exe', 'Signal.exe'],
      titlePatterns: ['*bank*'],
    });
    expect(d.emitted[0]!.rows.every((row) => !row.loosens)).toBe(true);
  });

  it.each([
    ['keepAnEye', true, { keepAnEye: false }],
    ['rollingMemory.enabled', true, {}],
    ['rollingMemory.minutes', 20, {}],
    ['screenshotRetention', 2, {}],
    ['sightDetail', 'all', {}],
    ['pickUp', true, { pickUp: false }],
  ] as const)('marks %s as letting Scout see or keep more', async (setting, value, start) => {
    const d = deps(start as Partial<Settings>);
    await change(d, [{ setting, value }]);
    expect(d.emitted[0]!.rows).toEqual([expect.objectContaining({ setting, loosens: true })]);
  });

  it('does not mark a change that sees or keeps less', async () => {
    const d = deps({ rollingMemory: { enabled: true, minutes: 20 } });
    await change(d, [
      { setting: 'rollingMemory.minutes', value: 5 },
      { setting: 'keepAnEye', value: false },
      { setting: 'screenshotRetention', value: 'off' },
    ]);
    expect(d.emitted[0]!.rows.map((row) => row.loosens)).toEqual([false, false]);
  });

  it('refuses a loosening change on a routine’s own turn, and allows a tightening one', async () => {
    const d = deps({ pickUp: false });
    const outcome = await change(d, [{ setting: 'pickUp', value: true }], ROUTINE);
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain('routine');
    expect(directivesIn(outcome.content)).toEqual([]);
    expect(d.emitted).toEqual([]);
    const ok = await change(d, [{ setting: 'voice.speed', value: 0.8 }], ROUTINE);
    expect(ok.isError).toBeUndefined();
    expect(d.emitted).toHaveLength(1);
  });

  it('lists current values in its description, with no secret-shaped string', () => {
    const d = deps({
      userName: 'Sam',
      voice: { ...SETTINGS_DEFAULTS.voice, elevenLabsVoiceId: 'sk-ant-api03-abcdefghijklmnop' },
      providerBaseUrls: { openrouter: 'https://openrouter.example/v1' },
    });
    const [tool] = fakeTurnTools({ changeSettings: d.value }).definitions;
    expect(tool!.description).toContain('voice.speed: 0.95');
    expect(tool!.description).toContain('userName: Sam');
    expect(tool!.description).not.toContain('sk-ant-api03');
    expect(tool!.description).not.toContain('openrouter.example');
  });

  it('switches Always listening off by card, and refuses to switch it on', async () => {
    const d = deps({ listening: { always: true } });
    const off = await change(d, [{ setting: 'listening.always', value: false }]);
    expect(off.isError).toBeUndefined();
    expect(d.emitted[0]!.patch.listening).toEqual({ always: false });
    const on = await change(deps(), [{ setting: 'listening.always', value: true }]);
    expect(on.isError).toBe(true);
    expect(on.content).toContain('switched on only by the person');
    expect(directivesIn(on.content)).toEqual([]);
  });

  it('picks a mouth or ears, notes the ElevenLabs key, and refuses an unknown mouth', async () => {
    const d = deps();
    await change(d, [
      { setting: 'voice.mouth', value: 'elevenlabs' },
      { setting: 'voice.ears', value: 'local' },
    ]);
    const rows = d.emitted[0]!.rows;
    expect(rows[0]).toMatchObject({ setting: 'voice.mouth', to: 'elevenlabs' });
    expect(rows[0]!.note).toContain('ElevenLabs key in Settings');
    expect(rows[1]).toMatchObject({ setting: 'voice.ears', to: 'local' });
    const bad = await change(d, [{ setting: 'voice.mouth', value: 'robot' }]);
    expect(bad.isError).toBe(true);
  });

  it('holds no secret store: its deps are the settings and the card only', () => {
    expect(Object.keys(deps().value).sort()).toEqual(['emit', 'get']);
  });

  it('may lower the privacy log’s days, never raise them', async () => {
    const d = deps();
    await change(d, [{ setting: 'sightLog.days', value: 3 }]);
    expect(d.emitted[0]!.patch.sightLog).toEqual({ days: 3 });
    const up = await change(d, [{ setting: 'sightLog.days', value: 30 }]);
    expect(up.isError).toBe(true);
    expect(up.content).toContain('only lower');
    expect(String(up.content)).not.toMatch(/\bI\b/);
  });

  it('sets a spending cap, and marks raising or removing it', async () => {
    const d = deps();
    await change(d, [{ setting: 'budget.dailyUsd', value: 1 }]);
    expect(d.emitted[0]!.patch.budget).toEqual({ dailyUsd: 1 });
    expect(d.emitted[0]!.rows[0]!.loosens).toBe(false);
    const capped = deps({ budget: { dailyUsd: 1 } });
    await change(capped, [{ setting: 'budget.dailyUsd', value: 5 }]);
    await change(capped, [{ setting: 'budget.dailyUsd', value: null }]);
    expect(capped.emitted.map((card) => card.rows[0]!.loosens)).toEqual([true, true]);
    expect(capped.emitted[1]!.patch.budget).toEqual({ dailyUsd: null });
  });

  it('switches gentle nudges on or off', async () => {
    const d = deps();
    await change(d, [{ setting: 'wellbeing.enabled', value: true }]);
    expect(d.emitted[0]!.patch.wellbeing).toEqual({ enabled: true });
  });

  it('says so when nothing would change, with no card', async () => {
    const d = deps();
    const outcome = await change(d, [{ setting: 'voice.speed', value: 0.95 }]);
    expect(outcome.isError).toBeUndefined();
    expect(outcome.content).toContain('already');
    expect(d.emitted).toEqual([]);
  });
});

describe('talkPatchProblem: main re-checks an applied card, never trusting the renderer', () => {
  const current = Settings.parse({
    ...SETTINGS_DEFAULTS,
    voice: { ...SETTINGS_DEFAULTS.voice, microphoneId: 'mic-1', mouth: 'kokoro' },
    captureExclusions: { processNames: ['Signal.exe'], titlePatterns: ['*bank*'] },
    listening: { always: true },
    sightLog: { days: 7 },
  });

  it('passes every card the tool itself builds', async () => {
    const d = deps({
      voice: current.voice,
      captureExclusions: current.captureExclusions,
      listening: current.listening,
      sightLog: current.sightLog,
    });
    await change(d, [
      { setting: 'voice.speed', value: 0.85 },
      { setting: 'hotkeys.talk', value: 'RightShift' },
      { setting: 'listening.always', value: false },
      { setting: 'captureExclusions.add', value: 'Teams.exe' },
      { setting: 'sightLog.days', value: 3 },
      { setting: 'keepAnEye', value: true },
      { setting: 'screenshotRetention', value: 24 },
      { setting: 'budget.dailyUsd', value: null },
    ]);
    expect(talkPatchProblem(current, d.emitted[0]!.patch)).toBeNull();
  });

  it('refuses settings off the allowlist, whatever the renderer sends', () => {
    const refused: SettingsPatch[] = [
      { providerBaseUrls: { ...current.providerBaseUrls, openrouter: 'https://evil.example' } },
      { summarizer: { providerId: 'openrouter', model: 'x' } },
      { enginePort: 1234 },
      { closedCleanly: !current.closedCleanly },
      { lastVersion: '9.9.9' },
      { userNameDeclined: !current.userNameDeclined },
      { watch: { ...current.watch, maxChecks: 500 } },
      { pageTextBudget: current.pageTextBudget + 1 },
    ];
    for (const patch of refused) {
      expect(talkPatchProblem(current, patch), JSON.stringify(patch)).not.toBeNull();
    }
  });

  it('refuses a voice object that changes or wipes a field off the allowlist', () => {
    const { microphoneId: _mic, ...wiped } = current.voice;
    expect(talkPatchProblem(current, { voice: wiped })).not.toBeNull();
    expect(
      talkPatchProblem(current, { voice: { ...current.voice, microphoneId: 'mic-2' } }),
    ).not.toBeNull();
    const { mouth: _mouth, ...noMouth } = current.voice;
    expect(talkPatchProblem(current, { voice: noMouth })).not.toBeNull();
    expect(talkPatchProblem(current, { voice: { ...current.voice, speed: 0.8 } })).toBeNull();
  });

  it('refuses removing a capture exclusion, raising the log, or switching listening on', () => {
    expect(
      talkPatchProblem(current, {
        captureExclusions: { processNames: [], titlePatterns: ['*bank*'] },
      }),
    ).toContain('Settings');
    expect(talkPatchProblem(current, { sightLog: { days: 30 } })).not.toBeNull();
    const off = Settings.parse({ ...current, listening: { always: false } });
    expect(talkPatchProblem(off, { listening: { always: true } })).toContain(
      'switched on only by the person',
    );
  });

  it('lets through a patch that changes nothing', () => {
    expect(talkPatchProblem(current, {})).toBeNull();
    expect(
      talkPatchProblem(current, { voice: current.voice, enginePort: current.enginePort }),
    ).toBeNull();
  });
});
