/**
 * The few 16px line icons the Connections page and the shared setup pieces draw (search, chevrons,
 * external link, tick, error, caution). One stroke style so they sit together. Contains Icon.
 */

const PATHS = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.6" />
      <path d="M10.4 10.4 14 14" />
    </>
  ),
  chevRight: <path d="M6 3.5 10.5 8 6 12.5" />,
  chevDown: <path d="M3.5 6 8 10.5 12.5 6" />,
  external: (
    <path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2.5" />
  ),
  check: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="m5.3 8.2 1.9 1.9 3.6-3.8" />
    </>
  ),
  tick: <path d="m4 8.4 2.6 2.6L12 5.4" />,
  error: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.8v3.6M8 10.9v.1" />
    </>
  ),
  caution: (
    <>
      <path d="M8 2.2 14.3 13H1.7L8 2.2Z" />
      <path d="M8 6.5v3M8 11.3v.1" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="cx-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
