/**
 * MoneyField: a dollar text field with minus and plus buttons. Typed text is passed through
 * untouched (the caller validates); only the buttons step, by 1, and never below 1 (a daily limit of 0 is not allowed).
 */
import { Button } from './button';

function step(text: string, by: number): string {
  const now = Number(text.trim());
  const base = text.trim() !== '' && Number.isFinite(now) ? now : 0;
  // Round away float noise such as 0.1 + 1 -> 1.1000000000000001.
  return String(Math.max(1, Math.round((base + by) * 100) / 100));
}

export function MoneyField({
  id,
  label,
  value,
  onChange,
  onCommit,
  invalid = false,
  hideLabel = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange(text: string): void;
  onCommit?: () => void;
  invalid?: boolean;
  /** Keep the label for assistive tech and tests when a heading above already says it. */
  hideLabel?: boolean;
}) {
  return (
    <div className="tg-money">
      <label htmlFor={id} className={hideLabel ? 'tg-sr-only' : undefined}>
        {label}
      </label>
      <div className="tg-money__row">
        <span className="tg-money__prefix" aria-hidden="true">
          $
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          aria-invalid={invalid ? 'true' : undefined}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            onCommit?.();
          }}
        />
        <Button variant="secondary" aria-label="Decrease" onClick={() => onChange(step(value, -1))}>
          −
        </Button>
        <Button variant="secondary" aria-label="Increase" onClick={() => onChange(step(value, 1))}>
          +
        </Button>
      </div>
    </div>
  );
}
