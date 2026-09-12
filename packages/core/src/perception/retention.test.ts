import { describe, expect, it } from 'vitest';
import { Settings, type ScreenshotRetention } from '@tagalong/protocol';
import { mayPersistScreenshot } from './retention';

const WITH_SHOT = {
  screenshot: { mime: 'image/png', base64: 'iVBORw0KGgo=', width: 8, height: 8 },
} as const;

describe('mayPersistScreenshot', () => {
  it('refuses under the shipped default, which is off', () => {
    expect(mayPersistScreenshot(WITH_SHOT, Settings.parse({}).screenshotRetention)).toBe(false);
  });

  it('allows persistence once a retention window is set', () => {
    const retention: ScreenshotRetention = { mode: 'hours', hours: 24 };
    expect(mayPersistScreenshot(WITH_SHOT, retention)).toBe(true);
  });

  it('is false when the snapshot carries no screenshot at all', () => {
    expect(mayPersistScreenshot({}, { mode: 'hours', hours: 24 })).toBe(false);
  });
});
