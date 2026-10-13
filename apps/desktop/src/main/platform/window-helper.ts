/**
 * The window enumeration helper, and the wrapper that runs it.
 *
 * The C# for the P/Invokes is one single-quoted line rather than a here-string. PowerShell
 * reading commands from stdin silently swallows an `Add-Type @"..."@` block and everything
 * after it: the process exits 0, prints nothing, and reports no error. That failure is
 * invisible from the outside, which is exactly why the script is shaped to avoid it and
 * why a test asserts the here-string never comes back.
 *
 * The script is a string here rather than a file on disk. A bundled `.ps1` has to survive
 * electron-vite's build, the asar archive and the installer, and each of those is a way
 * for the inventory to work in development and be missing in the packaged app. A string
 * cannot go missing. It is fed to PowerShell over stdin, which also sidesteps every
 * quoting question a long `-Command` argument would raise.
 */

/**
 * Enumerates top-level windows and prints them as JSON.
 *
 * Reads no window contents. That is what makes the inventory cheap enough to attach to
 * every capture: walking a window's descendants is what costs — on a real desktop one
 * background browser window alone yielded 34,588 characters. The text layer does that
 * deliberately, for one window, when asked.
 */
export const LIST_WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class TagalongWin { [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'
$foreground = [TagalongWin]::GetForegroundWindow()
$root = [System.Windows.Automation.AutomationElement]::RootElement
$tops = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$out = New-Object System.Collections.ArrayList
foreach ($w in $tops) {
  try {
    $h = [IntPtr]$w.Current.NativeWindowHandle
    if ($h -eq [IntPtr]::Zero) { continue }
    $iconic = [TagalongWin]::IsIconic($h)
    if (-not $iconic -and -not [TagalongWin]::IsWindowVisible($h)) { continue }
    $proc = ''
    try { $proc = (Get-Process -Id $w.Current.ProcessId -ErrorAction Stop).ProcessName } catch { continue }
    $r = $w.Current.BoundingRectangle
    $null = $out.Add([pscustomobject]@{
      handle      = [int64]$h
      processName = $proc
      title       = $w.Current.Name
      minimized   = [bool]$iconic
      foreground  = ($h -eq $foreground)
      bounds      = [pscustomobject]@{
        x      = [int][math]::Round($r.X)
        y      = [int][math]::Round($r.Y)
        width  = [int][math]::Round($r.Width)
        height = [int][math]::Round($r.Height)
      }
    })
  } catch { continue }
}
ConvertTo-Json -Depth 4 -Compress @($out)
`;

/**
 * Encodes a script for PowerShell's `-EncodedCommand`: UTF-16LE, then base64.
 *
 * The whole script arrives as one argument and is parsed as one script block. That is the
 * point. `-Command -`, which feeds the script over stdin, parses line by line: a `foreach`
 * whose body spans lines, or an `Add-Type @"..."@`, produces nothing at all — exit 0, no
 * output, no error, and every statement after it lost. The same text saved as a .ps1 runs
 * correctly, which is what makes the failure so easy to ship.
 *
 * Base64 of UTF-16LE is about 2.7 times the script's length, and Windows allows roughly
 * 32,000 characters of command line, so these scripts sit an order of magnitude inside the
 * limit.
 */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** The slice of a spawned child this wrapper touches, so a test can hand over its own. */
export interface HelperChild {
  stdout: { on(event: 'data', listener: (chunk: unknown) => void): unknown };
  stdin?: { write(chunk: string): unknown; end(): unknown } | null;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  kill(): unknown;
}

/**
 * Stop collecting past this much output.
 *
 * The timeout bounds how long a runaway helper runs, not how much it can print in that
 * time. A megabyte is far past any real enumeration and well short of a problem for the
 * main process's heap.
 */
const MAX_OUTPUT_BYTES = 1_000_000;

/**
 * Runs the helper and returns whatever it printed.
 *
 * Never rejects. Every failure — PowerShell missing, blocked by policy, a window that
 * hangs the accessibility tree — resolves to the output collected so far, and the parser
 * turns anything unusable into an empty inventory. The pet then knows less about the
 * desktop, which is a far better outcome than the ask failing because one window would
 * not answer.
 */
export function runWindowHelper(
  spawnChild: (encoded: string) => HelperChild,
  script: string,
  timeoutMs: number,
  /** Data for the script's stdin, such as a picture to read. Too large for an argument. */
  input?: string,
): Promise<string> {
  return new Promise<string>((resolve) => {
    let child: HelperChild;
    try {
      child = spawnChild(encodePowerShellCommand(script));
    } catch {
      resolve('');
      return;
    }

    let output = '';
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(output);
    };

    const timer = setTimeout(() => {
      // Partial output beats none: a mostly-enumerated desktop still tells the pet what
      // is open. The kill stops the helper from outliving the ask that wanted it.
      try {
        child.kill();
      } catch {
        // Already gone. Nothing to stop.
      }
      finish();
    }, timeoutMs);

    if (input !== undefined) {
      try {
        child.stdin?.write(input);
        child.stdin?.end();
      } catch {
        // A helper that already died answers with nothing, below.
      }
    }

    child.stdout.on('data', (chunk) => {
      if (settled || output.length >= MAX_OUTPUT_BYTES) return;
      output += String(chunk);
    });
    child.on('close', finish);
    child.on('error', () => {
      output = '';
      finish();
    });
  });
}
