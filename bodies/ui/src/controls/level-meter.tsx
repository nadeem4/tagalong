/**
 * LevelMeter: a read-only bar for a 0..1 level (the microphone test). role="meter" so a screen
 * reader hears a percentage (in steps of 10, so it is not read out 30 times a second); the bar turns gold at the loud end.
 */
import type { CSSProperties } from 'react';

export function LevelMeter({
  level,
  label = 'Microphone level',
}: {
  level: number;
  label?: string;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, level)) * 100);
  return (
    <div
      className="tg-meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent / 10) * 10}
    >
      <div
        className={`tg-meter__bar${percent >= 80 ? ' tg-meter__bar--loud' : ''}`}
        style={{ '--level': `${percent}%` } as CSSProperties}
      />
    </div>
  );
}
