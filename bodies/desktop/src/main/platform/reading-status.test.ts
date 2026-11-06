/** Tests for the reading-status script, its parser and detectReading. */

import { describe, expect, it, vi } from 'vitest';
import { DETECT_TIMEOUT_MS, READING_SCRIPT, detectReading, parseReading } from './reading-status';

describe('parseReading', () => {
  it('maps a working machine to two working rows', () => {
    expect(parseReading('window-text=ok\nocr=ok\ndisplay=en-US\nprofile=en-US')).toEqual({
      rows: [
        { capability: 'window-text', engine: 'windows-uia', where: 'this-pc', state: 'working' },
        {
          capability: 'text-from-pictures',
          engine: 'windows-ocr',
          where: 'this-pc',
          state: 'working',
        },
      ],
    });
  });

  it('reports needs-language-pack with the display language and profile languages', () => {
    const ocr = parseReading('window-text=ok\nocr=missing\ndisplay=fr-FR\nprofile=fr-FR,en-US')
      .rows[1];
    expect(ocr).toMatchObject({
      state: 'needs-language-pack',
      language: 'fr-FR',
      profile_languages: ['fr-FR', 'en-US'],
    });
  });

  it('says not-working for both rows when the output is empty (script blocked or timed out)', () => {
    expect(parseReading('').rows.map((r) => r.state)).toEqual(['not-working', 'not-working']);
  });

  it('never says needs-language-pack without a usable display tag', () => {
    expect(parseReading('window-text=ok\nocr=missing\ndisplay=\nprofile=').rows[1]?.state).toBe(
      'not-working',
    );
  });

  it('never lets a malformed display tag through', () => {
    const ocr = parseReading('window-text=ok\nocr=missing\ndisplay=en-US; calc\nprofile=').rows[1];
    expect(ocr?.state).toBe('not-working');
  });

  it('says not-working for a row whose line failed', () => {
    const rows = parseReading('window-text=fail\nocr=ok\ndisplay=en-US\nprofile=en-US').rows;
    expect(rows.map((r) => r.state)).toEqual(['not-working', 'working']);
  });
});

describe('detectReading', () => {
  it('survives a runner that throws', async () => {
    const run = async (): Promise<string> => {
      throw new Error('powershell missing');
    };
    expect((await detectReading(run)).rows.map((r) => r.state)).toEqual([
      'not-working',
      'not-working',
    ]);
  });

  it('passes the detection timeout to the runner', async () => {
    const run = vi.fn(async () => 'window-text=ok\nocr=ok\ndisplay=en-US\nprofile=en-US');
    await detectReading(run);
    expect(run).toHaveBeenCalledWith(READING_SCRIPT, DETECT_TIMEOUT_MS);
  });
});

describe('the detection script', () => {
  it('uses UI Automation, the profile-language recogniser and the display language', () => {
    expect(READING_SCRIPT).toContain('UIAutomationClient');
    expect(READING_SCRIPT).toContain('TryCreateFromUserProfileLanguages');
    expect(READING_SCRIPT).toContain('Get-WinUILanguageOverride');
    expect(READING_SCRIPT).toContain('Get-UICulture');
  });

  it('needs no elevation: it never asks for Windows capabilities', () => {
    expect(READING_SCRIPT).not.toMatch(/Get-WindowsCapability|RunAs/);
  });

  it('has no multi-line here-string', () => {
    expect(READING_SCRIPT).not.toMatch(/@['"]\s*$/m);
  });
});
