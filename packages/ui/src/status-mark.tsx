/**
 * One status mark, in one of two looks: a small tag on Scout, or a muted row in the bubble with
 * Fix it when the wording table names a fix. Neutral words from protocol's STATUS_WORDS, never
 * spoken, never in Scout's voice. Contains StatusMark.
 */

import { STATUS_WORDS } from '@tagalong/protocol';
import type { FixTarget, StatusMark as Mark } from '@tagalong/protocol';
import { themeTokens as t } from './theme/tokens';

export interface StatusMarkProps {
  mark: Mark;
  variant: 'tag' | 'row';
  /** The row's Fix it; the tag never has one (Scout is the button, its bubble has the row). */
  onFix?: (target: FixTarget) => void;
}

export function StatusMark({ mark, variant, onFix }: StatusMarkProps) {
  const { tag, detail, fix } = STATUS_WORDS[mark.id];
  // A mark with a fix is a problem: the warn colour. A hint is muted.
  const tone = fix !== undefined ? 'warn' : 'muted';
  if (variant === 'tag') {
    return (
      <span
        data-testid="status-mark"
        data-id={mark.id}
        data-tone={tone}
        title={detail}
        style={{
          position: 'absolute',
          // Bottom centre, just above the 8 px recording and listening dots in the corners.
          bottom: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '2px 7px',
          borderRadius: 999,
          background: tone === 'warn' ? t.color.warnFill : '#6B7290',
          color: tone === 'warn' ? t.color.warnInk : t.color.text,
          fontFamily: t.font.ui,
          fontSize: t.fontSize.min,
          fontWeight: t.fontWeight.semibold,
          whiteSpace: 'nowrap',
        }}
      >
        {tag}
      </span>
    );
  }
  return (
    <p
      role="status"
      data-testid="status-row"
      data-id={mark.id}
      data-tone={tone}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: t.space.md,
        margin: 0,
        fontFamily: t.font.ui,
        fontSize: t.fontSize.small,
        color: tone === 'warn' ? '#F2D48A' : t.color.textMuted,
      }}
    >
      <span style={{ flex: 1 }}>{detail}</span>
      {fix !== undefined && onFix !== undefined && (
        <button type="button" className="bubble-quiet" onClick={() => onFix(fix)}>
          Fix it
        </button>
      )}
    </p>
  );
}
