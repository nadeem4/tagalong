import { describe, expect, it } from 'vitest';
import { captureNotice, captureTooltip } from './capture-notice';

const AT = new Date(2026, 8, 11, 9, 5);

describe('captureNotice', () => {
  it('records when a screenshot was taken, in a sentence the panel can show', () => {
    const notice = captureNotice({ at: AT, screenshot: true });

    expect(notice.at).toBe(AT.toISOString());
    expect(notice.screenshot).toBe(true);
    expect(notice.message).toBe('Tagalong captured the screen.');
    expect(notice.blocked).toBeUndefined();
  });

  it('says what a text-only capture read, so the badge never overstates it', () => {
    const notice = captureNotice({ at: AT, screenshot: false });

    expect(notice.screenshot).toBe(false);
    expect(notice.message).toBe('Tagalong read the selection and the active window.');
  });

  it('names the matched rule and nothing else when an app is excluded', () => {
    const notice = captureNotice({
      at: AT,
      screenshot: true,
      blocked: { rule: 'processName', entry: '1Password.exe' },
    });

    expect(notice.blocked).toEqual({ rule: 'processName', entry: '1Password.exe' });
    expect(notice.message).toBe(
      'Capture is blocked here — the exclusion "1Password.exe" matches this app.',
    );
  });

  it('names the title pattern when the window title is what matched', () => {
    const notice = captureNotice({
      at: AT,
      screenshot: true,
      blocked: { rule: 'titlePattern', entry: '*Bitwarden*' },
    });

    expect(notice.message).toBe(
      'Capture is blocked here — the exclusion "*Bitwarden*" matches this window title.',
    );
  });
});

describe('captureTooltip', () => {
  it('tells the user the screen was captured, and when', () => {
    expect(captureTooltip(captureNotice({ at: AT, screenshot: true }))).toBe(
      'Tagalong captured the screen at 09:05',
    );
  });

  it('does not claim a screenshot for a text-only capture', () => {
    expect(captureTooltip(captureNotice({ at: AT, screenshot: false }))).toBe(
      'Tagalong read the selection at 09:05',
    );
  });

  it('reports a refused capture rather than a successful one', () => {
    const notice = captureNotice({
      at: AT,
      screenshot: true,
      blocked: { rule: 'processName', entry: '1Password.exe' },
    });

    expect(captureTooltip(notice)).toBe('Tagalong did not capture at 09:05 — blocked in this app');
  });
});
