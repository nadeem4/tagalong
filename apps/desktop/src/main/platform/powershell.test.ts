import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { powerShellArgs } from './powershell';

describe('powerShellArgs', () => {
  it('passes the script as an encoded command', () => {
    const args = powerShellArgs('QQBCAEMA');

    expect(args).toContain('-EncodedCommand');
    expect(args[args.length - 1]).toBe('QQBCAEMA');
  });

  it('never reads the script from stdin', () => {
    // `-Command -` parses stdin line by line and silently discards any block spanning
    // lines. It produced an empty window list on a desktop with twelve windows open,
    // with exit 0 and nothing on either stream.
    const args = powerShellArgs('QQBCAEMA');

    expect(args).not.toContain('-Command');
    expect(args).not.toContain('-');
  });

  it('suppresses the profile, which would otherwise print onto the parsers stdout', () => {
    expect(powerShellArgs('x')).toContain('-NoProfile');
  });

  it('refuses to wait for a prompt', () => {
    // Without this a helper that hits an interactive prompt hangs until the timeout,
    // turning a fast failure into a slow one.
    expect(powerShellArgs('x')).toContain('-NonInteractive');
  });
});

describe('the host starts PowerShell in exactly one place', () => {
  /**
   * Structural, because the alternative already failed once.
   *
   * When the platform and the transport test each held their own copy of the spawn
   * arguments, changing the platform's broke the application and left every test green.
   * A second copy anywhere reintroduces exactly that blind spot, so the count is asserted
   * rather than trusted to review.
   */
  it('has no other module spawning powershell.exe', () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const offenders = readdirSync(here)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) => name !== 'powershell.ts')
      .filter((name) => readFileSync(`${here}${name}`, 'utf8').includes('powershell.exe'));

    expect(offenders).toEqual([]);
  });
});
