/**
 * Reading one window's text out of the accessibility tree.
 *
 * The enumeration in `window-helper.ts` deliberately reads no contents, which is what
 * makes the inventory cheap enough to attach to every capture. This is the other half:
 * the deliberate, per-window read the pet spends a tool call on once it knows which
 * window it wants.
 */

/**
 * How long the walk of one window may run before it returns what it has.
 *
 * Under the three seconds the phase page allows for the whole call, leaving room for
 * PowerShell to start and for the JSON to come back. Measured on a real desktop, the
 * heaviest single window — a background browser holding 34,588 characters — took 829ms,
 * so this is roughly triple the worst real case.
 */
export const WINDOW_TEXT_WALK_MS = 2_500;

/** Per-window budget for the counting pass, which visits many windows in one call. */
export const WINDOW_COUNT_WALK_MS = 400;

/**
 * Guards the one place a value reaches PowerShell.
 *
 * Window handles are the only thing interpolated into these scripts, and they are always
 * integers. Keeping it that way is deliberate: the moment a string is interpolated into a
 * shell script, a window title someone else controls becomes a code path.
 */
function safeHandle(handle: number): number {
  if (typeof handle !== 'number' || !Number.isSafeInteger(handle)) {
    throw new TypeError(`a window handle must be a safe integer, got ${String(handle)}`);
  }
  return handle;
}

/**
 * The tree walk both scripts share.
 *
 * Finds the window by handle and collects its text-bearing descendants. It starts from
 * that element and never from the desktop root, so a read cannot quietly widen into an
 * enumeration of everything on screen.
 */
const WALK_PRELUDE = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$textCond = New-Object System.Windows.Automation.OrCondition(
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document))
)
function Get-TagalongWindow([int64]$handle) {
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty, [int]$handle)
  return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
    [System.Windows.Automation.TreeScope]::Children, $cond)
}
function Get-TagalongText($element, [int]$budgetMs) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $found = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCond)
  $rows = New-Object System.Collections.ArrayList
  foreach ($e in $found) {
    if ($sw.ElapsedMilliseconds -gt $budgetMs) { break }
    try {
      $v = ''
      try { $v = $e.Current.Name } catch { }
      try {
        $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($vp -and $vp.Current.Value) { $v = $vp.Current.Value }
      } catch { }
      if ([string]::IsNullOrWhiteSpace($v)) { continue }
      $r = $e.Current.BoundingRectangle
      $null = $rows.Add([pscustomobject]@{
        name  = $e.Current.Name
        type  = $e.Current.ControlType.ProgrammaticName
        value = $v
        top   = [int][math]::Round($r.Y)
        left  = [int][math]::Round($r.X)
      })
    } catch { continue }
  }
  return $rows
}
`;

/**
 * A script that reads one window's text.
 *
 * Prints an empty array when the window has gone, which happens more often than it
 * sounds: the pet chooses a window from an inventory taken moments earlier, and the user
 * may have closed it since.
 */
export function readWindowTextScript(handle: number): string {
  return `${WALK_PRELUDE}
$w = Get-TagalongWindow ${safeHandle(handle)}
if ($null -eq $w) { '[]' } else {
  ConvertTo-Json -Depth 3 -Compress @(Get-TagalongText $w ${WINDOW_TEXT_WALK_MS})
}
`;
}

/**
 * A script that counts readable characters for several windows.
 *
 * Counting means walking, which is the expensive part — so this runs only over windows
 * the exclusion list already allowed, and gives each one a short budget. A count that
 * stopped at its budget is a floor rather than a total, which is fine: the pet is
 * deciding whether a read is worth a tool call, and no such decision turns on precision.
 *
 * A handle that is not a safe integer is dropped rather than throwing. One bad entry from
 * enumeration must not cost the counts for every other window.
 */
export function countWindowTextScript(handles: readonly number[]): string {
  const safe = handles.filter(
    (handle) => typeof handle === 'number' && Number.isSafeInteger(handle),
  );
  return `${WALK_PRELUDE}
$handles = @(${safe.join(',')})
$out = New-Object System.Collections.ArrayList
foreach ($h in $handles) {
  try {
    $w = Get-TagalongWindow $h
    if ($null -eq $w) { continue }
    $chars = 0
    foreach ($row in (Get-TagalongText $w ${WINDOW_COUNT_WALK_MS})) { $chars += $row.value.Length }
    $null = $out.Add([pscustomobject]@{ handle = [int64]$h; chars = $chars })
  } catch { continue }
}
ConvertTo-Json -Depth 3 -Compress @($out)
`;
}

/** One element as the helper prints it. */
interface RawNode {
  name: string;
  type: string;
  value: string;
  top: number;
  left: number;
}

export interface WindowTextReading {
  text: string;
  /** True when the cap cut the read short, so a pet does not read a stop as an ending. */
  truncated: boolean;
}

const EMPTY: WindowTextReading = { text: '', truncated: false };

function isRawNode(value: unknown): value is RawNode {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RawNode>;
  return typeof candidate.name === 'string' || typeof candidate.value === 'string';
}

function textOf(node: RawNode): string {
  // Value over name: UIA reports a textbox's label as Name and its contents as Value, and
  // the contents are what the user is looking at.
  const raw =
    typeof node.value === 'string' && node.value.trim().length > 0 ? node.value : node.name;
  return typeof raw === 'string' ? raw : '';
}

/**
 * Turns the helper's output into the window's text, in reading order.
 *
 * Sorting happens here rather than in PowerShell so it can be tested without a desktop. A
 * UIA tree walk returns nesting and z-order, which has nothing to do with the order a
 * person reads in — a terminal whose last line arrives before its first is worse than no
 * text at all, because it reads as though it were correct.
 *
 * Forgiving on malformed input for the same reason the enumeration parser is: the helper
 * shares stdout with whatever PowerShell prints, and returns partial output when it times
 * out. A read that yields nothing costs the pet some knowledge. A thrown error costs the
 * user their ask.
 */
export function parseWindowText(stdout: string, maxChars: number): WindowTextReading {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return EMPTY;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return EMPTY;
  }

  const entries = (Array.isArray(parsed) ? parsed : [parsed]).filter(isRawNode);
  const ordered = [...entries].sort(
    (a, b) => (a.top ?? 0) - (b.top ?? 0) || (a.left ?? 0) - (b.left ?? 0),
  );

  const lines: string[] = [];
  for (const node of ordered) {
    // One element can hold several lines; splitting keeps the line count honest and lets
    // the duplicate check work on what the user would call a line.
    for (const line of textOf(node).split(/\r?\n/)) {
      const clean = line.trim();
      if (clean.length === 0) continue;
      // A Document element commonly republishes the text of the element inside it.
      // Collapsing only *consecutive* repeats drops that without merging two terminal
      // lines that happen to read the same.
      if (lines[lines.length - 1] === clean) continue;
      lines.push(clean);
    }
  }

  return capped(lines, maxChars);
}

/**
 * Joins lines up to the cap, preferring to stop at a line boundary.
 *
 * Handing back half a word reads as corruption; handing back whole lines and saying so
 * reads as a budget. Only when the very first line is itself over the cap does this cut
 * mid-line, because returning nothing would be worse.
 */
function capped(lines: readonly string[], maxChars: number): WindowTextReading {
  const whole = lines.join('\n');
  if (whole.length <= maxChars) return { text: whole, truncated: false };

  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    const addition = kept.length === 0 ? line.length : line.length + 1;
    if (length + addition > maxChars) break;
    kept.push(line);
    length += addition;
  }

  if (kept.length === 0) return { text: whole.slice(0, maxChars), truncated: true };
  return { text: kept.join('\n'), truncated: true };
}
