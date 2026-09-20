import { describe, expect, it } from 'vitest';

import { runPowerShellScript } from './powershell';
import { LIST_WINDOWS_SCRIPT } from './window-helper';
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
 *
 * Timeouts are generous because these start real processes on a machine that may be doing
 * it for the first time. An earlier version asserted `Add-Type -TypeDefinition` on its own
 * and timed out on CI at five seconds while the C# compiler warmed up. That check was
 * redundant anyway: the enumeration script itself defines a type, so the end-to-end case
 * below covers it through the code that actually ships.
 */
const onWindows = process.platform === 'win32';

/**
 * The application's own runner, not a copy of it.
 *
 * The first version of this file re-declared the spawn arguments beside a comment saying
 * they were kept in step with `Win32Platform` by hand. They were not, and could not be:
 * changing `-EncodedCommand` to `-Command` at the real call site broke the app and left
 * every one of these green. The test proved the mechanism works, which was never in doubt,
 * and never touched the thing that actually breaks — which arguments the app passes.
 *
 * That is the original bug's shape one level up. There, fixture tests proved the parser
 * and never reached the transport. Here, the detector proved the transport and never
 * reached the call site. Both times the check could not fail.
 */
function runRealHelper(script: string, timeoutMs = 45_000): Promise<string> {
  return runPowerShellScript(script, timeoutMs);
}

describe.skipIf(!onWindows)('the PowerShell transport, against a real PowerShell', () => {
  it('runs a script whose block spans several lines', { timeout: 60_000 }, async () => {
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

  it('enumerates the real desktop without failing', { timeout: 60_000 }, async () => {
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

  it(
    'gives every enumerated window the shape the parser promises',
    { timeout: 60_000 },
    async () => {
      const outcome = parseWindowList(await runRealHelper(LIST_WINDOWS_SCRIPT));

      for (const window of outcome.windows) {
        expect(window.id).toMatch(/^w-\d+$/);
        expect(window.processName.length).toBeGreaterThan(0);
        expect(['foreground', 'background', 'minimized']).toContain(window.state);
      }
    },
  );
});
