/**
 * Scout's still mark: its head as a small SVG (gold shell, dark screen, sky eyes), the same
 * colours the live mascot wears. It is drawn beside lines Scout starts, in Home's nav tile and
 * in the tour, where a live WebGL canvas per line would be too heavy. Decorative; the word
 * "Scout" next to it is the real text. Contains ScoutGlyph and ScoutMark.
 */

import { themeTokens as t } from './theme/tokens';

/** Scout's head, drawn to fill a square of `size` px. */
export function ScoutGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <line x1="16" y1="3.5" x2="16" y2="7" stroke={t.color.textMuted} strokeWidth="1.2" />
      <circle cx="16" cy="3" r="1.7" fill={t.color.sky} />
      <rect x="0.8" y="13" width="3.2" height="7.5" rx="1.6" fill={t.color.keycapLine} />
      <rect x="28" y="13" width="3.2" height="7.5" rx="1.6" fill={t.color.keycapLine} />
      <rect x="3" y="7" width="26" height="19" rx="7" fill={t.color.gold} />
      <rect x="6" y="10" width="20" height="13" rx="4.5" fill={t.color.goldInk} />
      <rect x="10.5" y="14" width="3.6" height="5.2" rx="1.8" fill={t.color.sky} />
      <rect x="17.9" y="14" width="3.6" height="5.2" rx="1.8" fill={t.color.sky} />
    </svg>
  );
}

interface ScoutMarkProps {
  /** The tile's side in px. */
  size?: number;
}

export function ScoutMark({ size = 20 }: ScoutMarkProps) {
  return (
    <span className="scout-mark" aria-hidden="true" style={{ width: size, height: size }}>
      <ScoutGlyph size={Math.round(size * 0.82)} />
    </span>
  );
}
