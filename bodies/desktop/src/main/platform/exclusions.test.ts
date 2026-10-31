/** Tests for capture exclusions: lists, title globs, secret files and built-in blind spots. */
import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS, type CaptureExclusions } from '../../shared/settings';
import { findCaptureBlock, secretFileRule } from './exclusions';

describe('secretFileRule', () => {
  it('names the secret-file rule a file name matches', () => {
    expect(secretFileRule('.env')).toBe('.env');
    expect(secretFileRule('.env.local')).toBe('.env.*');
    expect(secretFileRule('ID_RSA')).toBe('id_rsa');
    expect(secretFileRule('secrets.yaml')).toBe('secrets.*');
  });

  it('passes an ordinary file', () => {
    expect(secretFileRule('report.md')).toBeNull();
    expect(secretFileRule('environment.md')).toBeNull();
  });
});

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
      { processName: 'chrome.exe', title: 'My Acme Vault - Google Chrome' },
      { ...NONE, titlePatterns: ['*acme*'] },
    );
    expect(block).toEqual({ rule: 'titlePattern', entry: '*acme*' });
  });

  it('anchors title patterns, so a pattern without wildcards is an exact title', () => {
    expect(
      findCaptureBlock({ title: 'Acme Console' }, { ...NONE, titlePatterns: ['Acme Console'] }),
    ).not.toBeNull();
    expect(
      findCaptureBlock(
        { title: 'The Acme Console thing' },
        { ...NONE, titlePatterns: ['Acme Console'] },
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

describe('the built-in blind spots', () => {
  it('block a password manager even with an empty exclusion list', () => {
    expect(findCaptureBlock({ processName: 'Bitwarden.exe' }, NONE)).toEqual({
      rule: 'processName',
      entry: 'Bitwarden.exe',
    });
  });

  it('block a secret file open in an editor, named in the title', () => {
    for (const title of [
      '.env - ai_pet - Visual Studio Code',
      '● .env.local - ai_pet - Visual Studio Code',
      'id_rsa - Notepad',
      'C:\\Users\\me\\.ssh\\id_ed25519 - Notepad++',
      'prod.tfvars - infra - Visual Studio Code',
      'server.pem - Notepad',
    ]) {
      expect(findCaptureBlock({ processName: 'Code.exe', title }, NONE), title).toEqual(
        expect.objectContaining({ rule: 'titlePattern' }),
      );
    }
  });

  it('leave ordinary files alone, even ones whose names look close', () => {
    for (const title of [
      'environment.ts - ai_pet - Visual Studio Code',
      'README.md - ai_pet - Visual Studio Code',
      'env.example - Notepad',
      'id_rsa.pub - Notepad',
    ]) {
      expect(findCaptureBlock({ processName: 'Code.exe', title }, NONE), title).toBeNull();
    }
  });

  it('block private browsing windows', () => {
    expect(
      findCaptureBlock(
        { processName: 'msedge.exe', title: 'New tab - [InPrivate] - Microsoft Edge' },
        NONE,
      ),
    ).not.toBeNull();
  });
});
