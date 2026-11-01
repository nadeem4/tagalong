/**
 * Slider: a native range input (arrows, Home, End and PageUp/Down come free) with its label
 * above and the current value beside it, so the value is readable without dragging.
 */
import type { CSSProperties } from 'react';

export function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = String,
  invalid = false,
  describedBy,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(n: number): void;
  format?: (n: number) => string;
  invalid?: boolean;
  describedBy?: string | undefined;
}) {
  // The gold track runs up to the thumb; CSS reads the share from --fill.
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="tg-slider">
      <div className="tg-slider__head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
