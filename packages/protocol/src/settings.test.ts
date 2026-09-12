import { describe, expect, it } from 'vitest';
import { Settings, SettingsPatch } from './settings';

describe('Settings', () => {
  it('fills every default from an empty object', () => {
    const s = Settings.parse({});
    expect(s.enginePort).toBe(47321);
    expect(s.defaultPetId).toBe('scout');
    expect(s.providerId).toBe('anthropic');
    expect(s.defaultModel).toBe('claude-opus-5');
    expect(s.pageTextBudget).toBe(40_000);
    expect(s.historyMessages).toBe(20);
    expect(s.hotkeys.ask).toBe('CommandOrControl+Shift+Space');
    expect(s.avatar).toEqual({ x: null, y: null });
  });

  it('keeps explicit values', () => {
    const s = Settings.parse({
      enginePort: 50000,
      providerId: 'fake',
      hotkeys: { ask: 'Alt+Space' },
      avatar: { x: 12, y: 34 },
    });
    expect(s.enginePort).toBe(50000);
    expect(s.providerId).toBe('fake');
    expect(s.hotkeys.ask).toBe('Alt+Space');
    expect(s.avatar).toEqual({ x: 12, y: 34 });
  });

  it('rejects a privileged port', () => {
    expect(Settings.safeParse({ enginePort: 80 }).success).toBe(false);
  });

  it('rejects a port above the valid range', () => {
    expect(Settings.safeParse({ enginePort: 70000 }).success).toBe(false);
  });

  it('rejects a non-integer port', () => {
    expect(Settings.safeParse({ enginePort: 47321.5 }).success).toBe(false);
  });

  it('rejects a zero or negative page text budget', () => {
    expect(Settings.safeParse({ pageTextBudget: 0 }).success).toBe(false);
    expect(Settings.safeParse({ historyMessages: -1 }).success).toBe(false);
  });

  it('carries no secret fields', () => {
    const keys = Object.keys(Settings.parse({}));
    expect(keys.some((k) => /apikey|secret|token|password|credential/i.test(k))).toBe(false);
  });
});

describe('SettingsPatch', () => {
  it('accepts a single field', () => {
    expect(SettingsPatch.parse({ providerId: 'fake' })).toEqual({ providerId: 'fake' });
  });

  it('accepts an empty patch', () => {
    expect(SettingsPatch.parse({})).toEqual({});
  });

  it('still validates the fields it is given', () => {
    expect(SettingsPatch.safeParse({ enginePort: 80 }).success).toBe(false);
  });
});
