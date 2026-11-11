/**
 * The two small icons Scout's brain card draws: a warning triangle before "Update ready" and
 * a circle with a mark before the offline error line. Paths are the mockup's #i-alert and #i-err.
 */

export function AlertIcon() {
  return (
    <svg className="brain-icon" viewBox="0 0 16 16" aria-hidden="true" data-icon="alert">
      <path
        d="M8 2.2 14.3 13H1.7L8 2.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8 6.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.3" r=".9" fill="currentColor" />
    </svg>
  );
}

export function ErrIcon() {
  return (
    <svg className="brain-icon" viewBox="0 0 16 16" aria-hidden="true" data-icon="err">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.8v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="10.9" r=".9" fill="currentColor" />
    </svg>
  );
}
