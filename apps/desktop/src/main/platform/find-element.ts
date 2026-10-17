/**
 * Finding one element by its accessibility name inside one window, for point_at.
 *
 * Reads element names and one rectangle, nothing else. The search starts from the window's
 * handle, never from the desktop root, and the exclusion check runs before it, exactly as
 * a window text read does.
 * Contains findElementWith, findElementScript and parseFoundElement.
 */

import type { WindowEntry } from '@tagalong/protocol';

import type { WindowBounds } from './index';
import type { RunScript } from './text-layer';
import { PER_MONITOR_AWARE } from './window-helper';
import { handleOf } from './window-list';
import { WALK_PRELUDE, WINDOW_TEXT_WALK_MS } from './window-text';

/** Guards the handle, the one number interpolated into the script. */
function safeHandle(handle: number): number {
  if (typeof handle !== 'number' || !Number.isSafeInteger(handle)) {
    throw new TypeError(`a window handle must be a safe integer, got ${String(handle)}`);
  }
  return handle;
}

/**
 * The script: the window by handle, then its first descendant whose name matches exactly,
 * then the same name ignoring case. The name arrives as base64 and is decoded inside
 * PowerShell, so text a model chose never becomes code.
 */
export function findElementScript(handle: number, name: string): string {
  const encoded = Buffer.from(name, 'utf8').toString('base64');
  return `${PER_MONITOR_AWARE}${WALK_PRELUDE}
$w = Get-TagalongWindow ${safeHandle(handle)}
if ($null -eq $w) { '{"status":"gone"}' } else {
  $name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
  $nameProp = [System.Windows.Automation.AutomationElement]::NameProperty
  $e = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($nameProp, $name)))
  if ($null -eq $e) {
    $e = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($nameProp, $name, [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase)))
  }
  if ($null -eq $e) { '{"status":"missing"}' } else {
    $r = $e.Current.BoundingRectangle
    if ($r.IsEmpty -or $e.Current.IsOffscreen) { '{"status":"offscreen"}' } else {
      ConvertTo-Json -Compress ([pscustomobject]@{
        status = 'found'
        x = [int][math]::Round($r.X)
        y = [int][math]::Round($r.Y)
        width = [int][math]::Round($r.Width)
        height = [int][math]::Round($r.Height)
      })
    }
  }
}
`;
}

/** What the script printed, read forgivingly: anything odd is a failed search. */
export type FoundElement =
  { status: 'found'; rect: WindowBounds } | { status: 'missing' | 'gone' | 'offscreen' | 'failed' };

export function parseFoundElement(stdout: string): FoundElement {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return { status: 'failed' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { status: 'failed' };
  const row = parsed as Record<string, unknown>;
  if (row['status'] === 'missing' || row['status'] === 'gone' || row['status'] === 'offscreen') {
    return { status: row['status'] };
  }
  if (row['status'] !== 'found') return { status: 'failed' };
  const [x, y, width, height] = [row['x'], row['y'], row['width'], row['height']];
  const numbers = [x, y, width, height].every(
    (value) => typeof value === 'number' && Number.isFinite(value),
  );
  if (!numbers || (width as number) <= 0 || (height as number) <= 0) return { status: 'failed' };
  return {
    status: 'found',
    rect: { x: x as number, y: y as number, width: width as number, height: height as number },
  };
}

export interface FindElementDeps {
  /** The inventory, already classified against the exclusion list. */
  listWindows: () => Promise<readonly WindowEntry[]>;
  run: RunScript;
}

/** Found, in screen pixels, or not, with the reason in words the pet can repeat. */
export type FindElementAnswer =
  | { found: true; rect: WindowBounds }
  | { found: false; blocked?: WindowEntry['blocked']; notes: string[] };

function appOf(window: WindowEntry): string {
  return window.title === '' ? window.processName : `${window.processName} (${window.title})`;
}

export async function findElementWith(
  deps: FindElementDeps,
  params: { windowId: string; name: string },
): Promise<FindElementAnswer> {
  const windows = await deps.listWindows();
  const target = windows.find((window) => window.id === params.windowId);
  if (target === undefined) {
    return {
      found: false,
      notes: [
        `There is no window ${params.windowId} open. Ask for the window list again and pick from it.`,
      ],
    };
  }
  if (target.blocked !== undefined) {
    return {
      found: false,
      blocked: target.blocked,
      notes: ['That window is on the capture exclusion list. Nothing in it was read.'],
    };
  }
  if (target.state === 'minimized') {
    return {
      found: false,
      notes: [
        `It is in ${appOf(target)}, which is minimized. Ask the person to bring it forward and ask again.`,
      ],
    };
  }
  const handle = handleOf(target.id);
  if (handle === null) {
    return { found: false, notes: [`${target.id} is not a window id this host issued.`] };
  }

  let found: FoundElement;
  try {
    found = parseFoundElement(
      await deps.run(findElementScript(handle, params.name), WINDOW_TEXT_WALK_MS + 1_000),
    );
  } catch {
    found = { status: 'failed' };
  }

  switch (found.status) {
    case 'found':
      return { found: true, rect: found.rect };
    case 'missing':
      return {
        found: false,
        notes: [
          `There is no element named '${params.name}' in ${appOf(target)}. Check the name as it ` +
            'reads on screen, or describe where it is in words.',
        ],
      };
    case 'offscreen':
      return {
        found: false,
        notes: [
          `'${params.name}' is in ${appOf(target)} but not visible right now: it may be in a ` +
            'closed menu or scrolled away. Describe where to find it in words.',
        ],
      };
    case 'gone':
      return {
        found: false,
        notes: [`${appOf(target)} has closed since the window list was taken.`],
      };
    case 'failed':
      return {
        found: false,
        notes: ['Tagalong could not search that window just now. Describe where it is in words.'],
      };
  }
}
