/** Tests for the Settings schema, its defaults and SettingsPatch. */
import { describe, expect, it } from 'vitest';
import {
  SETTINGS_DEFAULTS,
  Settings,
  TALK_KEY_LABELS,
  TALK_KEY_RIGHT_CTRL,
  TALK_KEYS,
  SettingsPatch,
} from './settings';
import { chosenMouth } from './voice';

describe('Settings', () => {
  it('has exactly the live keys', () => {
    expect(Object.keys(Settings.parse({})).sort()).toEqual([
      'avatar',
      'captureExclusions',
      'hotkeys',
      'listening',
      'voice',
    ]);
  });

  it('fills every default from an empty object', () => {
    const s = Settings.parse({});
    expect(s.hotkeys.ask).toBe('CommandOrControl+Shift+Space');
    expect(s.hotkeys).toEqual({
      ask: 'CommandOrControl+Shift+Space',
      pauseSight: 'CommandOrControl+Shift+Alt+P',
      stopVoice: 'CommandOrControl+Shift+Alt+M',
      talk: 'RightControl',
    });
    expect(s.avatar).toEqual({ x: null, y: null });
  });

  it('drops the retired look and see-everything keys from an older settings file', () => {
    // Scout takes screenshots and reads other windows itself now, so those keys bind
    // nothing. An older file still parses; the keys simply fall away.
    const s = Settings.parse({
      hotkeys: { ask: 'Alt+Space', look: 'Alt+S', seeEverything: 'Alt+Shift+S' },
    });
    expect(s.hotkeys).toEqual({ ask: 'Alt+Space' });
  });

  it('drops every retired field of an older settings file, and a patch ignores them too', () => {
    const old = {
      providerId: 'anthropic',
      defaultModel: 'claude-opus-5',
      defaultPetId: 'ink',
      hiddenPets: ['bolt'],
      onboarding: { done: true },
      enginePort: 47321,
      userName: 'Ada',
      keepAnEye: true,
      sightDetail: 'all',
      budget: { dailyUsd: 1 },
    };
    expect(Object.keys(Settings.parse(old))).not.toContain('userName');
    expect(Settings.parse(old)).toEqual(Settings.parse({}));
    expect(SettingsPatch.parse(old)).toEqual({});
  });

  it('keeps explicit values', () => {
    const s = Settings.parse({
      hotkeys: { ask: 'Alt+Space' },
      avatar: { x: 12, y: 34 },
    });
    expect(s.hotkeys.ask).toBe('Alt+Space');
    expect(s.avatar).toEqual({ x: 12, y: 34 });
  });

  it('carries no secret fields', () => {
    const keys = Object.keys(Settings.parse({}));
    expect(keys.some((k) => /apikey|secret|token|password|credential/i.test(k))).toBe(false);
  });
});

describe('Settings.captureExclusions', () => {
  it('starts empty: password managers and the Windows prompts are built-in blind spots', () => {
    // Built in rather than defaults, so clearing your own list never takes them away.
    const { captureExclusions } = Settings.parse({});
    expect(captureExclusions).toEqual({ processNames: [], titlePatterns: [] });
  });

  it('accepts an empty list so a user can opt out of every default', () => {
    const s = Settings.parse({ captureExclusions: { processNames: [], titlePatterns: [] } });
    expect(s.captureExclusions).toEqual({ processNames: [], titlePatterns: [] });
  });

  it('rejects a blank entry, which would otherwise match every window', () => {
    expect(
      Settings.safeParse({ captureExclusions: { processNames: [''], titlePatterns: [] } }).success,
    ).toBe(false);
    expect(
      Settings.safeParse({ captureExclusions: { processNames: [], titlePatterns: ['  '] } })
        .success,
    ).toBe(false);
  });
});

describe('SettingsPatch', () => {
  it('accepts a single field', () => {
    expect(SettingsPatch.parse({ listening: { always: true } })).toEqual({
      listening: { always: true },
    });
  });

  it('accepts an empty patch', () => {
    expect(SettingsPatch.parse({})).toEqual({});
  });

  it('still validates the fields it is given', () => {
    expect(SettingsPatch.safeParse({ captureExclusions: { processNames: [''] } }).success).toBe(
      false,
    );
  });

  it('never invents fields that are omitted', () => {
    const patch = SettingsPatch.parse({ listening: { always: true } });
    expect(patch).not.toHaveProperty('captureExclusions');
    expect(patch).not.toHaveProperty('voice');
  });
});

describe('the pause hotkey setting', () => {
  it('ships a default that matches the documented key', () => {
    expect(SETTINGS_DEFAULTS.hotkeys.pauseSight).toBe('CommandOrControl+Shift+Alt+P');
  });

  it('collides with none of the other defaults', () => {
    const bound = Object.values(SETTINGS_DEFAULTS.hotkeys);
    expect(new Set(bound).size).toBe(bound.length);
  });

  it('stays optional, so a settings file written before it still parses', () => {
    // A patch replaces the whole hotkeys object, so rebinding the ask must not force a
    // caller to resend the pause key.
    const parsed = Settings.parse({ hotkeys: { ask: 'CommandOrControl+Shift+Space' } });
    expect(parsed.hotkeys.pauseSight).toBeUndefined();
  });

  it('accepts a rebinding', () => {
    const parsed = Settings.parse({
      hotkeys: { ask: 'CommandOrControl+Shift+Space', pauseSight: 'Alt+P' },
    });
    expect(parsed.hotkeys.pauseSight).toBe('Alt+P');
  });

  it('rejects an empty accelerator', () => {
    expect(
      Settings.safeParse({
        hotkeys: { ask: 'CommandOrControl+Shift+Space', pauseSight: '' },
      }).success,
    ).toBe(false);
  });
});

describe('Settings.voice', () => {
  const voiceWith = (change: object) => ({ voice: { ...SETTINGS_DEFAULTS.voice, ...change } });

  it('stores which mouth and which ears were picked, and refuses unknown ones', () => {
    const parsed = Settings.parse(voiceWith({ mouth: 'system', ears: 'local' })).voice;
    expect(parsed.mouth).toBe('system');
    expect(parsed.ears).toBe('local');
    expect(Settings.safeParse(voiceWith({ mouth: 'gpt-live' })).success).toBe(false);
    expect(Settings.safeParse(voiceWith({ ears: 'whisper' })).success).toBe(false);
  });

  it('keeps an ElevenLabs voice speaking for a settings file from before the picker', () => {
    const old = Settings.parse({ voice: { ...SETTINGS_DEFAULTS.voice, elevenLabsVoiceId: 'v1' } });
    expect(old.voice).not.toHaveProperty('mouth');
    expect(chosenMouth(old.voice)).toBe('elevenlabs');
  });

  it('talks by default, in the calm British voice, a touch slower than normal', () => {
    expect(Settings.parse({}).voice).toEqual({
      enabled: true,
      voice: 'bm_george',
      speed: 0.95,
      elevenLabsVoiceId: '',
    });
  });

  it('offers the two British male voices only', () => {
    expect(Settings.safeParse(voiceWith({ voice: 'bm_fable' })).success).toBe(true);
    expect(Settings.safeParse(voiceWith({ voice: 'af_heart' })).success).toBe(false);
  });

  it('keeps the speed within what still sounds like speech', () => {
    expect(Settings.safeParse(voiceWith({ speed: 0.2 })).success).toBe(false);
    expect(Settings.safeParse(voiceWith({ speed: 3 })).success).toBe(false);
  });

  it('rides in a patch alone', () => {
    const { voice } = voiceWith({ enabled: false });
    expect(SettingsPatch.parse({ voice })).toEqual({ voice });
  });
});

describe('Settings.hotkeys.stopVoice', () => {
  it('defaults to a key of its own, distinct from the others', () => {
    const { hotkeys } = Settings.parse({});
    expect(hotkeys.stopVoice).toBe('CommandOrControl+Shift+Alt+M');
    expect(new Set(Object.values(hotkeys)).size).toBe(4);
  });

  it('is optional in a patch, like the pause key', () => {
    expect(SettingsPatch.parse({ hotkeys: { ask: 'A' } })).toEqual({ hotkeys: { ask: 'A' } });
  });
});

describe('Settings.hotkeys.talk', () => {
  it('defaults to Right Ctrl held alone, apart from the ask key', () => {
    const { hotkeys } = Settings.parse({});
    expect(hotkeys.talk).toBe(TALK_KEY_RIGHT_CTRL);
    expect(TALK_KEY_RIGHT_CTRL).toBe('RightControl');
    expect(hotkeys.talk).not.toBe(hotkeys.ask);
  });

  it('moves any saved accelerator, the old default or a custom combo, to Right Ctrl', () => {
    for (const talk of ['CommandOrControl+Shift+Alt+Space', 'Alt+T']) {
      expect(Settings.parse({ hotkeys: { ask: 'A', talk } }).hotkeys).toEqual({
        ask: 'A',
        talk: 'RightControl',
      });
    }
  });

  it('keeps a single talk key the person picked', () => {
    expect(TALK_KEYS).toContain('RightShift');
    expect(Settings.parse({ hotkeys: { ask: 'A', talk: 'RightShift' } }).hotkeys.talk).toBe(
      'RightShift',
    );
  });

  it('names every talk key as a person reads it', () => {
    expect(TALK_KEY_LABELS.RightControl).toBe('Right Ctrl');
    for (const key of TALK_KEYS) expect(TALK_KEY_LABELS[key]).toBeTruthy();
  });

  it('refuses a patch that sets the talk key to a combo', () => {
    expect(SettingsPatch.safeParse({ hotkeys: { ask: 'A', talk: 'Alt+T' } }).success).toBe(false);
  });

  it('is optional, so a settings file from before it still parses', () => {
    expect(Settings.parse({ hotkeys: { ask: 'A' } }).hotkeys.talk).toBeUndefined();
  });
});

describe('Settings.voice.microphoneId', () => {
  it('is absent by default, which means the system default microphone', () => {
    expect(Settings.parse({}).voice.microphoneId).toBeUndefined();
  });

  it('keeps a picked microphone, and a voice from before it still parses', () => {
    const voice = { ...SETTINGS_DEFAULTS.voice, microphoneId: 'usb-mic' };
    expect(Settings.parse({ voice }).voice.microphoneId).toBe('usb-mic');
    expect(SettingsPatch.parse({ voice: { ...SETTINGS_DEFAULTS.voice } }).voice).toEqual(
      SETTINGS_DEFAULTS.voice,
    );
  });
});

describe('Settings.listening', () => {
  it('reads an old file without it as off', () => {
    expect(Settings.parse({ avatar: { x: 1, y: 2 } }).listening).toEqual({ always: false });
  });

  it('keeps Always listening on across a round trip', () => {
    const parsed = Settings.parse({ listening: { always: true } });
    expect(Settings.parse(JSON.parse(JSON.stringify(parsed))).listening).toEqual({ always: true });
  });

  it('rides in a patch', () => {
    expect(SettingsPatch.parse({ listening: { always: true } })).toEqual({
      listening: { always: true },
    });
  });
});
