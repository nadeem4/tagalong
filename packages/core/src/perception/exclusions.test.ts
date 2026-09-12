import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS, type CaptureExclusions } from '@tagalong/protocol';
import { findCaptureBlock } from './exclusions';

const DEFAULTS: CaptureExclusions = {
  processNames: [...SETTINGS_DEFAULTS.captureExclusions.processNames],
  titlePatterns: [...SETTINGS_DEFAULTS.captureExclusions.titlePatterns],
};

const NONE: CaptureExclusions = { processNames: [], titlePatterns: [] };

describe('findCaptureBlock', () => {
  it('blocks an exact process name match', () => {
    const block = findCaptureBlock(
      { processName: 'KeePass.exe', title: 'Database' },
      { ...NONE, processNames: ['KeePass.exe'] },
    );
    expect(block).toEqual({ rule: 'processName', entry: 'KeePass.exe' });
  });

  it('matches process names regardless of case', () => {
    const block = findCaptureBlock(
      { processName: 'KEEPASS.EXE' },
      { ...NONE, processNames: ['keepass.exe'] },
    );
    expect(block?.rule).toBe('processName');
  });

  it('matches whether or not either side carries the .exe suffix', () => {
    expect(
      findCaptureBlock({ processName: 'Bitwarden' }, { ...NONE, processNames: ['Bitwarden.exe'] }),
    ).not.toBeNull();
    expect(
      findCaptureBlock({ processName: 'Bitwarden.exe' }, { ...NONE, processNames: ['Bitwarden'] }),
    ).not.toBeNull();
  });

  it('does not match a process name by substring', () => {
    expect(
      findCaptureBlock(
        { processName: 'notkeepass.exe' },
        { ...NONE, processNames: ['keepass.exe'] },
      ),
    ).toBeNull();
  });

  it('blocks on a title pattern with wildcards, case-insensitively', () => {
    const block = findCaptureBlock(
      { processName: 'chrome.exe', title: 'My Bitwarden Vault - Google Chrome' },
      { ...NONE, titlePatterns: ['*bitwarden*'] },
    );
    expect(block).toEqual({ rule: 'titlePattern', entry: '*bitwarden*' });
  });

  it('anchors title patterns, so a pattern without wildcards is an exact title', () => {
    expect(
      findCaptureBlock(
        { title: 'Windows Security' },
        { ...NONE, titlePatterns: ['Windows Security'] },
      ),
    ).not.toBeNull();
    expect(
      findCaptureBlock(
        { title: 'The Windows Security thing' },
        { ...NONE, titlePatterns: ['Windows Security'] },
      ),
    ).toBeNull();
  });

  it('treats regex metacharacters in a pattern as literal text', () => {
    expect(findCaptureBlock({ title: 'aaaa' }, { ...NONE, titlePatterns: ['a.*'] })).toBeNull();
    expect(findCaptureBlock({ title: 'a.*' }, { ...NONE, titlePatterns: ['a.*'] })).not.toBeNull();
  });

  it('allows an ordinary window', () => {
    expect(
      findCaptureBlock({ processName: 'Code.exe', title: 'exclusions.ts - ai_pet' }, DEFAULTS),
    ).toBeNull();
  });

  it('allows capture when there is no active window to judge', () => {
    expect(findCaptureBlock(undefined, DEFAULTS)).toBeNull();
    expect(findCaptureBlock({}, DEFAULTS)).toBeNull();
    expect(findCaptureBlock({ processName: '', title: '' }, DEFAULTS)).toBeNull();
  });

  it('blocks a real password manager window with the shipped defaults', () => {
    const block = findCaptureBlock({ processName: '1Password.exe', title: '1Password' }, DEFAULTS);
    expect(block?.rule).toBe('processName');

    const credentialPrompt = findCaptureBlock(
      { processName: 'CredentialUIBroker.exe', title: 'Windows Security' },
      DEFAULTS,
    );
    expect(credentialPrompt).not.toBeNull();
  });

  it('blocks a password manager reached through the browser, by title', () => {
    const block = findCaptureBlock(
      { processName: 'msedge.exe', title: 'Vault - LastPass - Microsoft Edge' },
      DEFAULTS,
    );
    expect(block?.rule).toBe('titlePattern');
  });
});
