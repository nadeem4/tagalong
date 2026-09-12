import type { ContextSnapshot } from '@tagalong/protocol';

/** Why the pet cannot see, when the reason is worth saying out loud. */
export type SightProblem = 'blocked' | 'failed';

export interface SightBarProps {
  /** Null when nothing is attached — the bar still renders, it just says so. */
  snapshot: ContextSnapshot | null;
  problem: SightProblem | null;
  /** Asks the host for a screenshot of the active window. */
  onLook: () => void;
  /** Drops the attached context without closing the panel. */
  onClear: () => void;
}

/**
 * Sight is a state, so it is always on screen. A pet that can see and a pet that
 * cannot used to look identical — an empty chip rendered nothing — and the only way
 * to find out was to ask and be told no. This bar never renders nothing.
 */
export function SightBar({ snapshot, problem, onLook, onClear }: SightBarProps) {
  const attached = describe(snapshot);
  const seeing = attached !== null;
  const state = seeing ? 'seeing' : (problem ?? 'blind');
  const screenshot = snapshot?.screenshot;

  return (
    <div
      data-testid="sight-bar"
      data-state={state}
      className={`flex items-center gap-2 border-b px-3 py-1.5 text-xs ${
        seeing ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'
      }`}
    >
      <span aria-hidden="true">{seeing ? '👁' : '🚫'}</span>
      <span className={`font-semibold ${seeing ? 'text-amber-700' : 'text-slate-500'}`}>
        {seeing ? 'Seeing' : LABEL_BY_PROBLEM[problem ?? 'blind']}
      </span>
      {screenshot !== undefined && (
        <img
          data-testid="sight-thumbnail"
          src={`data:${screenshot.mime};base64,${screenshot.base64}`}
          alt="Screenshot attached to the next ask"
          className="h-6 w-10 rounded border border-amber-200 object-cover"
        />
      )}
      {attached !== null && <span className="truncate text-slate-600">{attached}</span>}
      <span className="ml-auto flex shrink-0 gap-1.5">
        {seeing ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600"
          >
            Clear
          </button>
        ) : (
          <button
            type="button"
            onClick={onLook}
            className="rounded-md border border-dashed border-slate-400 bg-white px-2 py-0.5 font-medium text-slate-600"
          >
            Look at screen
          </button>
        )}
      </span>
    </div>
  );
}

const LABEL_BY_PROBLEM: Record<SightProblem | 'blind', string> = {
  blind: 'Not seeing anything',
  blocked: 'Capture is blocked here',
  failed: 'Capture did not work',
};

/**
 * Names what leaves the machine rather than counting it: a wrong capture has to be
 * obvious before the answer arrives, not after. Null means nothing is attached.
 */
function describe(snapshot: ContextSnapshot | null): string | null {
  if (snapshot === null) {
    return null;
  }

  const parts: string[] = [];
  if (snapshot.selection !== undefined && snapshot.selection.length > 0) {
    parts.push(`${snapshot.selection.length} chars`);
  }
  if (snapshot.screenshot !== undefined) {
    parts.push(`screen ${snapshot.screenshot.width}×${snapshot.screenshot.height}`);
  }
  if (snapshot.app !== undefined) {
    parts.push(
      snapshot.app.windowTitle === undefined
        ? snapshot.app.name
        : `${snapshot.app.name} — ${snapshot.app.windowTitle}`,
    );
  }
  return parts.length === 0 ? null : parts.join(' · ');
}
