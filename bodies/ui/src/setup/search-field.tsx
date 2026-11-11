/**
 * The shared search box: full width, a search icon, an accessible name, and a live "Searching…"
 * line under it that screen readers announce while a search loads. Used by the Apps and Experts
 * tabs now, and by the tour and chat install card later. Contains SearchField.
 */
import { Icon } from './icons';

export function SearchField({
  label,
  placeholder,
  value,
  onChange,
  loading = false,
}: {
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
        {loading && (
          <span className="cx-waiting">
            <span className="cx-spin" aria-hidden="true" />
            Searching…
          </span>
        )}
      </p>
    </div>
  );
}
