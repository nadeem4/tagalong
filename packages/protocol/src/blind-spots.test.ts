/** Tests for the built-in blind spots and the secret file list. */
import { describe, expect, it } from 'vitest';
import { BLIND_SPOTS, BUILT_IN_EXCLUSIONS, SECRET_FILES } from './blind-spots';

describe('the built-in blind spots', () => {
  it('cover password managers and the Windows sign-in and security prompts', () => {
    const processes = BUILT_IN_EXCLUSIONS.processNames.map((p) => p.toLowerCase());
    for (const app of [
      '1password.exe',
      'bitwarden.exe',
      'keepass.exe',
      'keepassxc.exe',
      'lastpass.exe',
      'dashlane.exe',
      'enpass.exe',
      'credentialuibroker.exe',
      'logonui.exe',
      'consent.exe',
    ]) {
      expect(processes).toContain(app);
    }
    expect(BUILT_IN_EXCLUSIONS.titlePatterns).toContain('*Windows Security*');
  });

  it('cover private browsing, authenticators and remote desktop', () => {
    expect(BUILT_IN_EXCLUSIONS.titlePatterns).toEqual(
      expect.arrayContaining(['*InPrivate*', '*Incognito*', '*Private Browsing*']),
    );
    const processes = BUILT_IN_EXCLUSIONS.processNames.map((p) => p.toLowerCase());
    expect(processes).toEqual(expect.arrayContaining(['authy desktop.exe', 'mstsc.exe']));
  });

  it('name the secret files an editor can have open', () => {
    expect(SECRET_FILES).toEqual(
      expect.arrayContaining([
        '.env',
        '.env.*',
        '*.pem',
        '*.key',
        'id_rsa',
        'id_ed25519',
        '.npmrc',
        '.netrc',
        '.git-credentials',
        '*.tfvars',
        '*.kdbx',
      ]),
    );
  });

  it('give every group a label and a reason, for the Settings list', () => {
    for (const spot of BLIND_SPOTS) {
      expect(spot.label.length).toBeGreaterThan(0);
      expect(spot.reason.length).toBeGreaterThan(0);
    }
  });
});
