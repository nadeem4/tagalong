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
  value,
  options,
  onChange,
  describedBy,
}: {
  label: string;
  value: string;
  options: ThreeWayOption[];
  onChange(next: string): void;
  describedBy?: string | undefined;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const step = (from: number, by: 1 | -1): void => {
    const next = options[from + by];
    if (next === undefined || next.disabled === true) return;
    onChange(next.value);
    refs.current[from + by]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} aria-describedby={describedBy} className="tg-three">
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
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
