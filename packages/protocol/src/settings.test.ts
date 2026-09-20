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
    expect(s.hotkeys.look).toBe('CommandOrControl+Shift+S');
    expect(s.avatar).toEqual({ x: null, y: null });
  });

  it('keeps a rebound look hotkey', () => {
    const s = Settings.parse({ hotkeys: { ask: 'Alt+Space', look: 'Alt+S' } });
    expect(s.hotkeys.look).toBe('Alt+S');
  });

  it('accepts settings written before the look hotkey existed', () => {
    const s = Settings.parse({ hotkeys: { ask: 'Alt+Space' } });
    expect(s.hotkeys.look).toBeUndefined();
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

// ---------------------------------------------------------------------------
// Phase 2B: full view
// ---------------------------------------------------------------------------

describe('Settings.sightDetail', () => {
  it('defaults to focused, so a full-view capture stays one image plus one screen', () => {
    // `all` multiplies the bill by the monitor count on every ask that carries a look.
    // The default has to be the cheap one; the expensive one is a choice the user makes.
    expect(Settings.parse({}).sightDetail).toBe('focused');
    expect(SETTINGS_DEFAULTS.sightDetail).toBe('focused');
  });

  it('accepts all, which attaches every display', () => {
    expect(Settings.parse({ sightDetail: 'all' }).sightDetail).toBe('all');
  });

  it('rejects a detail level it does not know', () => {
    expect(Settings.safeParse({ sightDetail: 'everything' }).success).toBe(false);
    expect(Settings.safeParse({ sightDetail: 2 }).success).toBe(false);
  });

  it('is patchable on its own without resetting anything else', () => {
    const patch = SettingsPatch.parse({ sightDetail: 'all' });
    expect(patch.sightDetail).toBe('all');
    expect(patch).not.toHaveProperty('hotkeys');
    expect(patch).not.toHaveProperty('captureExclusions');
  });
});

describe('Settings.hotkeys.seeEverything', () => {
  it('has a default distinct from the other two', () => {
    const { ask, look, seeEverything } = SETTINGS_DEFAULTS.hotkeys;
    expect(seeEverything).toBe('CommandOrControl+Shift+Alt+S');
    expect(new Set([ask, look, seeEverything]).size).toBe(3);
  });

  it('parses a settings file written before this hotkey existed', () => {
    // Same reason `look` is optional: a patch replaces the whole hotkeys object, so a
    // caller rebinding only `ask` must not be forced to resend a key it never touched.
    const s = Settings.parse({ hotkeys: { ask: 'Alt+Space' } });
    expect(s.hotkeys.seeEverything).toBeUndefined();
  });

  it('keeps a rebound see-everything key', () => {
    const s = Settings.parse({ hotkeys: { ask: 'Alt+Space', seeEverything: 'Alt+Shift+S' } });
    expect(s.hotkeys.seeEverything).toBe('Alt+Shift+S');
  });

  it('rejects a blank accelerator, which would bind nothing and look like a bug', () => {
    expect(Settings.safeParse({ hotkeys: { ask: 'Alt+Space', seeEverything: '' } }).success).toBe(
      false,
    );
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
    // Same reason `look` and `seeEverything` are optional: a patch replaces the whole
    // hotkeys object, so rebinding one key must not force a caller to resend the rest.
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
