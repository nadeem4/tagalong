import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW_TEXT_CHARS, MAX_WINDOW_TEXT_CHARS } from './methods';
import {
  MAX_ROLLING_MEMORY_MINUTES,
  MAX_SCREENSHOT_RETENTION_HOURS,
  SETTINGS_DEFAULTS,
  Settings,
  SettingsPatch,
} from './settings';

describe('Settings providerBaseUrls', () => {
  it('starts empty, so every preset uses its built-in base URL', () => {
    expect(Settings.parse({}).providerBaseUrls).toEqual({});
  });

  it('keeps a base URL override per provider', () => {
    const s = Settings.parse({ providerBaseUrls: { openrouter: 'http://127.0.0.1:8080/v1' } });
    expect(s.providerBaseUrls).toEqual({ openrouter: 'http://127.0.0.1:8080/v1' });
  });

  it('rejects a base URL that is not a URL', () => {
    expect(Settings.safeParse({ providerBaseUrls: { nebius: 'not a url' } }).success).toBe(false);
  });

  it('can be patched on its own', () => {
    const patch = SettingsPatch.parse({ providerBaseUrls: { nebius: 'https://example.com/v1/' } });
    expect(patch).toEqual({ providerBaseUrls: { nebius: 'https://example.com/v1/' } });
  });
});

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
    expect(s.hotkeys).toEqual({
      ask: 'CommandOrControl+Shift+Space',
      pauseSight: 'CommandOrControl+Shift+Alt+P',
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

describe('Settings.windowTextBudget', () => {
  it('defaults to the documented per-window budget', () => {
    expect(Settings.parse({}).windowTextBudget).toBe(DEFAULT_WINDOW_TEXT_CHARS);
    expect(SETTINGS_DEFAULTS.windowTextBudget).toBe(DEFAULT_WINDOW_TEXT_CHARS);
  });

  it('accepts a raised budget up to the hard ceiling', () => {
    expect(Settings.parse({ windowTextBudget: 20_000 }).windowTextBudget).toBe(20_000);
    expect(Settings.parse({ windowTextBudget: MAX_WINDOW_TEXT_CHARS }).windowTextBudget).toBe(
      MAX_WINDOW_TEXT_CHARS,
    );
  });

  it('refuses a budget above the ceiling', () => {
    // The ceiling is the page-text cap. Past it one window can outweigh everything else
    // in the prompt, and the user raising a slider has no way to see that coming.
    expect(Settings.safeParse({ windowTextBudget: MAX_WINDOW_TEXT_CHARS + 1 }).success).toBe(false);
  });

  it('refuses a budget that would read nothing', () => {
    expect(Settings.safeParse({ windowTextBudget: 0 }).success).toBe(false);
    expect(Settings.safeParse({ windowTextBudget: -1 }).success).toBe(false);
    expect(Settings.safeParse({ windowTextBudget: 1.5 }).success).toBe(false);
  });

  it('rides in a patch without dragging the other settings with it', () => {
    const patch = SettingsPatch.parse({ windowTextBudget: 12_000 });
    expect(patch.windowTextBudget).toBe(12_000);
    expect(patch.sightDetail).toBeUndefined();
    expect(patch.captureExclusions).toBeUndefined();
  });
});

describe('Settings.summarizer', () => {
  it('defaults to none, meaning each pet summarises with its own brain', () => {
    expect(Settings.parse({}).summarizer).toBeNull();
  });

  it('keeps an explicit provider and model', () => {
    const summarizer = { providerId: 'openrouter', model: 'anthropic/claude-haiku-4.5' };
    expect(Settings.parse({ summarizer }).summarizer).toEqual(summarizer);
    expect(SettingsPatch.parse({ summarizer: null }).summarizer).toBeNull();
  });

  it('rejects a summarizer with no model', () => {
    expect(Settings.safeParse({ summarizer: { providerId: 'nebius', model: '' } }).success).toBe(
      false,
    );
  });
});

describe('Settings.hiddenPets', () => {
  it('shows every pet on the desktop by default', () => {
    expect(Settings.parse({}).hiddenPets).toEqual([]);
  });

  it('keeps the pets the user hid', () => {
    expect(SettingsPatch.parse({ hiddenPets: ['bolt'] }).hiddenPets).toEqual(['bolt']);
  });
});

describe('Settings.rollingMemory', () => {
  it('is off by default and holds ten minutes when turned on', () => {
    expect(Settings.parse({}).rollingMemory).toEqual({ enabled: false, minutes: 10 });
  });

  it('accepts one to thirty minutes and nothing else', () => {
    expect(Settings.safeParse({ rollingMemory: { enabled: true, minutes: 1 } }).success).toBe(true);
    expect(
      Settings.safeParse({ rollingMemory: { enabled: true, minutes: MAX_ROLLING_MEMORY_MINUTES } })
        .success,
    ).toBe(true);
    expect(Settings.safeParse({ rollingMemory: { enabled: true, minutes: 0 } }).success).toBe(
      false,
    );
    expect(Settings.safeParse({ rollingMemory: { enabled: true, minutes: 31 } }).success).toBe(
      false,
    );
  });

  it('rides in a patch alone', () => {
    const patch = SettingsPatch.parse({ rollingMemory: { enabled: true, minutes: 5 } });
    expect(patch.rollingMemory).toEqual({ enabled: true, minutes: 5 });
    expect(patch.watch).toBeUndefined();
  });
});

describe('Settings.watch', () => {
  it('defaults to 60 checks a watch, 3 watches at once and a 30 minute timeout', () => {
    expect(Settings.parse({}).watch).toEqual({
      maxChecks: 60,
      maxConcurrent: 3,
      defaultTimeoutMinutes: 30,
    });
  });

  it('refuses limits of zero', () => {
    const watch = { maxChecks: 0, maxConcurrent: 3, defaultTimeoutMinutes: 30 };
    expect(Settings.safeParse({ watch }).success).toBe(false);
    expect(
      Settings.safeParse({ watch: { ...watch, maxChecks: 5, maxConcurrent: 0 } }).success,
    ).toBe(false);
  });
});

describe('Settings.onboarding', () => {
  it('starts not done, so a fresh install opens the setup wizard', () => {
    expect(Settings.parse({}).onboarding).toEqual({ done: false });
  });

  it('parses a settings file written before onboarding existed', () => {
    expect(Settings.parse({ hiddenPets: [] }).onboarding.done).toBe(false);
  });

  it('rides in a patch alone, so finishing the wizard touches nothing else', () => {
    const patch = SettingsPatch.parse({ onboarding: { done: true } });
    expect(patch).toEqual({ onboarding: { done: true } });
  });
});

describe('Settings.welcome', () => {
  it('starts not done, so a fresh install opens the Welcome window', () => {
    expect(Settings.parse({}).welcome).toEqual({ done: false });
  });

  it('reads as not done on an install that finished the old wizard, so it sees Welcome once', () => {
    expect(Settings.parse({ onboarding: { done: true } }).welcome.done).toBe(false);
  });

  it('rides in a patch alone', () => {
    expect(SettingsPatch.parse({ welcome: { done: true } })).toEqual({ welcome: { done: true } });
  });
});

describe('Settings.greeting', () => {
  it('is on by default, so Scout says hello on a later launch', () => {
    expect(Settings.parse({}).greeting).toBe(true);
  });

  it('reads as on from a settings file written before it existed', () => {
    expect(Settings.parse({ welcome: { done: true } }).greeting).toBe(true);
  });

  it('can be switched off in a patch alone', () => {
    expect(SettingsPatch.parse({ greeting: false })).toEqual({ greeting: false });
  });
});

describe('Settings.lastOpenedAt', () => {
  it('starts unknown', () => {
    expect(Settings.parse({}).lastOpenedAt).toBeNull();
  });

  it('keeps an ISO time and rides in a patch alone', () => {
    const at = '2026-10-12T08:00:00.000Z';
    expect(Settings.parse({ lastOpenedAt: at }).lastOpenedAt).toBe(at);
    expect(SettingsPatch.parse({ lastOpenedAt: at })).toEqual({ lastOpenedAt: at });
  });

  it('refuses something that is not a time', () => {
    expect(Settings.safeParse({ lastOpenedAt: 'yesterday' }).success).toBe(false);
  });
});
