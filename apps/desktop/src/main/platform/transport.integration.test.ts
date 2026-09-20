import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { LIST_WINDOWS_SCRIPT, runWindowHelper } from './window-helper';
import { parseWindowList } from './window-list';

/**
 * The test that would have caught it.
 *
 * Every other test in this directory passed while the window enumeration was completely
 * non-functional, because every other test feeds the parser fixture output. The parsers
 * were never wrong. The transport carrying the script to PowerShell was, and no amount of
 * fixture testing can see that — which is how a broken enumeration shipped through a
 * task, a review and a green CI run.
 *
 * So this one starts a real PowerShell, the same way the app does, and checks that a
 * script comes back having actually run. It is slower than the rest of the suite by an
 * order of magnitude, and it earns that by testing the one thing the rest cannot.
 *
 * Deliberately independent of what is on the screen. A CI runner may have an unusual
 * desktop, and a test that needs a particular window would be flaky for reasons that have
 * nothing to do with the bug it guards.
 */
const onWindows = process.platform === 'win32';

/** Exactly how `Win32Platform` starts PowerShell. Kept in step with it on purpose. */
function runRealHelper(script: string, timeoutMs = 20_000): Promise<string> {
  return runWindowHelper(
    (encoded) =>
      spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true },
      ),
    script,
    timeoutMs,
  );
}

describe.skipIf(!onWindows)('the PowerShell transport, against a real PowerShell', () => {
  it('runs a script whose block spans several lines', { timeout: 30_000 }, async () => {
    // The exact shape that broke. Fed over stdin with `-Command -`, this prints nothing
    // at all: exit 0, empty stdout, empty stderr. If anyone moves the transport back,
    // this line goes red instead of the inventory quietly emptying.
    const script = [
      '$total = 0',
      'foreach ($i in @(1,2,3)) {',
      '  $total = $total + $i',
      '}',
      'Write-Output "SUM=$total"',
      '',
    ].join('\n');

    expect((await runRealHelper(script)).trim()).toContain('SUM=6');
  });

  it('runs a script that defines a type, which a here-string would have swallowed', async () => {
    const script = [
      "Add-Type -TypeDefinition 'public class TagalongTransportProbe { public static int N() { return 7; } }'",
      'Write-Output "N=$([TagalongTransportProbe]::N())"',
      '',
    ].join('\n');

    expect((await runRealHelper(script)).trim()).toContain('N=7');
  });

  it('enumerates the real desktop without failing', { timeout: 30_000 }, async () => {
    // The end-to-end claim: the script the app actually ships, through the transport the
    // app actually uses, comes back as something the parser can read.
    //
    // `no-windows` is tolerated and `no-output` is not, on purpose. A build agent's
    // session may genuinely have nothing enumerable, and failing on that would make this
    // flaky for a reason unrelated to what it guards. Zero bytes back from PowerShell is
    // never legitimate, and that is the failure that actually shipped.
    const outcome = parseWindowList(await runRealHelper(LIST_WINDOWS_SCRIPT));

    expect(outcome.failure).not.toBe('no-output');
    expect(outcome.failure).not.toBe('unparseable');
  });

  it('gives every enumerated window the shape the parser promises', async () => {
    const outcome = parseWindowList(await runRealHelper(LIST_WINDOWS_SCRIPT));

    for (const window of outcome.windows) {
      expect(window.id).toMatch(/^w-\d+$/);
      expect(window.processName.length).toBeGreaterThan(0);
      expect(['foreground', 'background', 'minimized']).toContain(window.state);
    }
  });
});
