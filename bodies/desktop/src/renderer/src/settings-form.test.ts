/** Tests for buildSettingsPatch and the Settings form helpers. */
import { describe, expect, it } from 'vitest';

import {
  SettingsFieldError,
  buildSettingsPatch,
  isAdvancedField,
  keyCaps,
  voiceFacts,
} from './settings-form';
import type { SettingsFormValues } from './settings-form';

const values: SettingsFormValues = {
  askHotkey: 'CommandOrControl+Shift+Space',
  pauseSightHotkey: 'CommandOrControl+Shift+Alt+P',
  stopVoiceHotkey: 'CommandOrControl+Shift+Alt+M',
  talkHotkey: 'RightControl',
};

describe('buildSettingsPatch removed fields', () => {
  it('never emits a key the Settings schema no longer has', () => {
    const patch = buildSettingsPatch({
      ...values,
      rollingMemoryEnabled: true,
      rollingMemoryMinutes: '5',
      voiceEnabled: true,
      voice: 'bm_george',
      voiceSpeed: '1',
    });
    const live = ['avatar', 'captureExclusions', 'hotkeys', 'listening', 'rollingMemory', 'voice'];
    expect(Object.keys(patch).filter((key) => !live.includes(key))).toEqual([]);
    for (const removed of ['sightDetail', 'windowTextBudget', 'greeting', 'userName', 'watch']) {
      expect(patch).not.toHaveProperty(removed);
    }
  });
});

describe('buildSettingsPatch', () => {
  it('carries both hotkeys, because a patch replaces the whole object', () => {
    // A form that sent only the ask would silently drop a rebound pause key back to its
    // default: nothing failed, nothing warned.
    const patch = buildSettingsPatch(values);

    expect(patch.hotkeys).toEqual({
      ask: 'CommandOrControl+Shift+Space',
      pauseSight: 'CommandOrControl+Shift+Alt+P',
      stopVoice: 'CommandOrControl+Shift+Alt+M',
      talk: 'RightControl',
    });
  });

  it('carries the talk key picked: one key from the list, never a combo', () => {
    expect(buildSettingsPatch({ ...values, talkHotkey: 'RightShift' }).hotkeys?.talk).toBe(
      'RightShift',
    );
    expect(() => buildSettingsPatch({ ...values, talkHotkey: 'Alt+T' })).toThrow();
  });

  it('keeps a rebound hotkey exactly as typed', () => {
    const patch = buildSettingsPatch({ ...values, askHotkey: 'CommandOrControl+Alt+V' });
    expect(patch.hotkeys?.ask).toBe('CommandOrControl+Alt+V');
    expect(patch.hotkeys?.pauseSight).toBe('CommandOrControl+Shift+Alt+P');
  });

  it('refuses one combination for two shortcuts, naming both and marking the second', () => {
    const save = () => buildSettingsPatch({ ...values, stopVoiceHotkey: 'ctrl+shift+SPACE' });
    expect(save).toThrow(SettingsFieldError);
    expect(save).toThrow(
      'Stop Scout speaking uses the same keys as Ask Scout. Pick a different combination.',
    );
    try {
      save();
    } catch (error) {
      expect((error as SettingsFieldError).field).toBe('stopVoiceHotkey');
    }
  });

  it('trims surrounding whitespace rather than sending an unregisterable accelerator', () => {
    const patch = buildSettingsPatch({ ...values, askHotkey: '  CommandOrControl+Shift+Space  ' });
    expect(patch.hotkeys?.ask).toBe('CommandOrControl+Shift+Space');
  });

  it('sends nothing the user did not set, so a save cannot reset a neighbouring setting', () => {
    const patch = buildSettingsPatch(values);
    expect(Object.keys(patch)).toEqual(['hotkeys']);
  });
});

describe('field errors', () => {
  it('names the field a refused value belongs to, so Settings can mark it', () => {
    let caught: unknown;
    try {
      buildSettingsPatch({ ...values, rollingMemoryEnabled: true, rollingMemoryMinutes: '45' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SettingsFieldError);
    expect(caught).toMatchObject({ field: 'rollingMemoryMinutes' });
    expect(isAdvancedField('askHotkey')).toBe(false);
    expect(isAdvancedField('rollingMemoryMinutes')).toBe(false);
  });
});

describe('keyCaps', () => {
  it('shows an accelerator as the keys to press on this computer', () => {
    expect(keyCaps('CommandOrControl+Shift+Alt+P', 'win32')).toEqual(['Ctrl', 'Shift', 'Alt', 'P']);
    expect(keyCaps('CommandOrControl+Shift+Space', 'darwin')).toEqual(['Cmd', 'Shift', 'Space']);
  });
});

describe('buildSettingsPatch rolling memory', () => {
  const memory = { rollingMemoryEnabled: true, rollingMemoryMinutes: '5' };

  it('carries the switch and the minutes when the form shows them', () => {
    expect(buildSettingsPatch({ ...values, ...memory }).rollingMemory).toEqual({
      enabled: true,
      minutes: 5,
    });
  });

  it('leaves it alone when the form does not show it', () => {
    expect(buildSettingsPatch(values).rollingMemory).toBeUndefined();
  });

  it('refuses minutes outside one to thirty, saying the bounds', () => {
    expect(() => buildSettingsPatch({ ...values, ...memory, rollingMemoryMinutes: '45' })).toThrow(
      /1 and 30/,
    );
  });
});

describe('buildSettingsPatch voice', () => {
  const voice = {
    voiceEnabled: true,
    voice: 'bm_fable',
    voiceSpeed: '1.05',
    elevenLabsVoiceId: '  abc123  ',
  };

  it('carries the switch, the voice, the speed and a trimmed ElevenLabs voice', () => {
    expect(buildSettingsPatch({ ...values, ...voice }).voice).toEqual({
      enabled: true,
      voice: 'bm_fable',
      speed: 1.05,
      elevenLabsVoiceId: 'abc123',
    });
  });

  it('keeps a picked microphone, and leaves it out for the system default', () => {
    expect(
      buildSettingsPatch({ ...values, ...voice, microphoneId: 'usb-mic' }).voice?.microphoneId,
    ).toBe('usb-mic');
    expect(buildSettingsPatch({ ...values, ...voice, microphoneId: '' }).voice).not.toHaveProperty(
      'microphoneId',
    );
  });

  it('carries the picked mouth and ears', () => {
    expect(
      buildSettingsPatch({ ...values, ...voice, mouth: 'system', ears: 'local' }).voice,
    ).toMatchObject({
      mouth: 'system',
      ears: 'local',
    });
    expect(buildSettingsPatch({ ...values, ...voice }).voice).not.toHaveProperty('mouth');
  });

  it('turns Scout quiet when the switch is off', () => {
    expect(buildSettingsPatch({ ...values, ...voice, voiceEnabled: false }).voice?.enabled).toBe(
      false,
    );
  });

  it('leaves the voice alone when the form does not show it', () => {
    expect(buildSettingsPatch(values)).not.toHaveProperty('voice');
  });

  it('refuses a speed outside what still sounds like speech, naming the field', () => {
    expect(() => buildSettingsPatch({ ...values, ...voice, voiceSpeed: '2' })).toThrow(
      expect.objectContaining({ field: 'voiceSpeed' }),
    );
  });

  it('opens Advanced for a refused ElevenLabs field', () => {
    expect(isAdvancedField('elevenLabsVoiceId')).toBe(true);
    expect(isAdvancedField('key:elevenlabs')).toBe(true);
    expect(isAdvancedField('voiceSpeed')).toBe(false);
  });
});

describe('voiceFacts', () => {
  it('says plainly what an adapter needs and costs', () => {
    const facts = { id: 'x', slot: 'mouth', label: 'X', screenshots: false } as const;
    expect(voiceFacts({ ...facts, offline: true, needsKey: false, costs: false })).toBe(
      'Works offline. Free.',
    );
    expect(voiceFacts({ ...facts, offline: false, needsKey: true, costs: true })).toBe(
      'Needs the internet. Needs your key. Costs money.',
    );
  });
});
