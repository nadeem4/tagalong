/**
 * ThreeWay: a small segmented control for a choice of two or three words (Off, Ask, Auto).
 * Native buttons in a radio group with a roving tab stop; arrow keys move the choice, as
 * native radios do. The look lives in CONTROLS_CSS.
 */
import { useRef } from 'react';

export interface ThreeWayOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function ThreeWay({
  label,
  labelledBy,
  value,
  options,
  onChange,
  describedBy,
}: {
  /** The group's name when no visible text names it. */
  label?: string;
  /** The id of visible text that names the group; wins over `label`. */
  labelledBy?: string;
  value: string;
  options: ThreeWayOption[];
  onChange(next: string): void;
  describedBy?: string | undefined;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys land on the next enabled option and wrap round, as native radios do.
  const step = (from: number, by: 1 | -1): void => {
    for (let hops = 1; hops < options.length; hops += 1) {
      const at = (from + by * hops + options.length * hops) % options.length;
      const next = options[at];
      if (next === undefined || next.disabled === true) continue;
      onChange(next.value);
      refs.current[at]?.focus();
      return;
    }
  };

  // One tab stop: the chosen option, or the first enabled one when that is disabled or missing.
  const chosen = options.find((option) => option.value === value && option.disabled !== true);
  const stop = (chosen ?? options.find((option) => option.disabled !== true))?.value;

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy === undefined ? label : undefined}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="tg-three"
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === stop ? 0 : -1}
          disabled={option.disabled === true}
          className="tg-three__option"
          onClick={() => {
            if (option.value !== value) onChange(option.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              step(index, 1);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              step(index, -1);
            }
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
