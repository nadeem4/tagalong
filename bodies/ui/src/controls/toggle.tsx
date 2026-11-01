/**
 * Toggle: a 44x24 switch with the word On or Off. A native button, so Space and Enter work
 * without extra key handling (adding any would fire twice).
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  id,
}: {
  checked: boolean;
  onChange(next: boolean): void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      className="tg-toggle"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="tg-toggle__word" aria-hidden="true">
        {checked ? 'On' : 'Off'}
      </span>
      <span className="tg-toggle__knob" aria-hidden="true" />
    </button>
  );
}
