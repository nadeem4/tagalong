import { describe, expect, it } from 'vitest';
import {
  MAX_SCREENSHOT_RETENTION_HOURS,
  SETTINGS_DEFAULTS,
  Settings,
  SettingsPatch,
} from './settings';

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

describe('Settings.captureExclusions', () => {
  it('ships defaults that cover password managers and the Windows credential UI', () => {
    const { captureExclusions } = Settings.parse({});
    const processes = captureExclusions.processNames.map((p) => p.toLowerCase());
    expect(processes).toContain('1password.exe');
    expect(processes).toContain('bitwarden.exe');
    expect(processes).toContain('keepass.exe');
    expect(processes).toContain('lastpass.exe');
    expect(processes).toContain('credentialuibroker.exe');
    expect(captureExclusions.titlePatterns).toContain('*Windows Security*');
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

describe('Settings.screenshotRetention', () => {
  it('is off by default, so screenshots never reach the database unasked', () => {
    expect(Settings.parse({}).screenshotRetention).toEqual({ mode: 'off' });
    expect(SETTINGS_DEFAULTS.screenshotRetention.mode).toBe('off');
  });

  it('accepts the 24 hour debugging window', () => {
    const s = Settings.parse({ screenshotRetention: { mode: 'hours', hours: 24 } });
    expect(s.screenshotRetention).toEqual({ mode: 'hours', hours: 24 });
  });

  it('rejects retention beyond the documented maximum', () => {
    expect(
      Settings.safeParse({
        screenshotRetention: { mode: 'hours', hours: MAX_SCREENSHOT_RETENTION_HOURS + 1 },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown mode and a mode without its hours', () => {
    expect(Settings.safeParse({ screenshotRetention: { mode: 'forever' } }).success).toBe(false);
    expect(Settings.safeParse({ screenshotRetention: { mode: 'hours' } }).success).toBe(false);
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

  it('never invents the new privacy fields when they are omitted', () => {
    const patch = SettingsPatch.parse({ providerId: 'fake' });
    expect(patch).not.toHaveProperty('captureExclusions');
    expect(patch).not.toHaveProperty('screenshotRetention');
  });

  it('validates the privacy fields it is given', () => {
    expect(SettingsPatch.safeParse({ screenshotRetention: { mode: 'off' } }).success).toBe(true);
    expect(SettingsPatch.safeParse({ screenshotRetention: { mode: 'weeks' } }).success).toBe(false);
  });
});
