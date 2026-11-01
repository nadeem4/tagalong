/**
 * Select: a native select (keeps the OS keyboard, list and aria) with a drawn chevron and a
 * label above it. The control look lives in CONTROLS_CSS.
 */
export function Select({
  id,
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange(value: string): void;
  options: { value: string; label: string }[];
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="tg-select">
      {label !== undefined && (
        <label htmlFor={id} className="tg-select__label">
          {label}
        </label>
      )}
      <div className="tg-select__wrap">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <svg className="tg-select__chevron" viewBox="0 0 12 8" aria-hidden="true">
          <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </div>
    </div>
  );
}
