/**
 * The shared search box: full width, a search icon, an accessible name, and a live line under it
 * that screen readers announce: "Searching…" while a search loads, else an optional note. Used by the Apps and Experts
 * tabs now, and by the tour and chat install card later. Contains SearchField.
 */
import { Icon } from './icons';

export function SearchField({
  label,
  placeholder,
  value,
  onChange,
  loading = false,
  note,
}: {
  /** What the line says when nothing is loading, such as `Results for "linear"`. */
  note?: string | undefined;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  loading?: boolean;
}) {
  return (
    <div className="cx-search">
      <div className="cx-search__box">
        <Icon name="search" />
        <input
          type="search"
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <p role="status" className="cx-search__status">
        {loading ? (
          <span className="cx-waiting">
            <span className="cx-spin" aria-hidden="true" />
            Searching…
          </span>
        ) : (
          note !== undefined && <span className="cx-search__note">{note}</span>
        )}
      </p>
    </div>
  );
}
