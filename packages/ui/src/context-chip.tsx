import type { ContextSnapshot } from '@tagalong/protocol';

export interface ContextChipProps {
  /** Null when the host captured nothing, so the chip stays out of the way. */
  snapshot: ContextSnapshot | null;
}

/**
 * States what leaves the machine with the next ask. The selection is summarised by
 * length instead of shown, because the point is consent, not a preview.
 */
export function ContextChip({ snapshot }: ContextChipProps) {
  if (snapshot === null) {
    return null;
  }

  const parts: string[] = [];
  if (snapshot.selection !== undefined && snapshot.selection.length > 0) {
    parts.push(`${snapshot.selection.length} chars selected`);
  }
  if (snapshot.app !== undefined) {
    parts.push(snapshot.app.name);
    if (snapshot.app.windowTitle !== undefined) {
      parts.push(snapshot.app.windowTitle);
    }
  }
  if (parts.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="context-chip"
      className="flex items-center gap-2 border-b border-slate-200 px-3 py-1.5 text-xs text-slate-600"
    >
      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
        Attaching
      </span>
      <span className="truncate">{parts.join(' · ')}</span>
    </div>
  );
}
