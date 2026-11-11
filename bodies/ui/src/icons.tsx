/**
 * The small 16px line icons the design mockups use (chevrons, search, check, error). They draw in
 * the current text colour, so a parent's `color` tints them. Contains Icon and its names.
 */
import type { ReactElement } from 'react';

const PATHS = {
  'chev-r': <path d="M6 3.5 10.5 8 6 12.5" />,
  'chev-d': <path d="M3.5 6 8 10.5 12.5 6" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.6" />
      <path d="M10.4 10.4 14 14" />
    </>
  ),
  check: (
    <>
      <circle cx="8" cy="8" r="6.2" strokeWidth="1.5" />
      <path d="m5.3 8.2 1.9 1.9 3.6-3.8" />
    </>
  ),
  err: (
    <>
      <circle cx="8" cy="8" r="6.2" strokeWidth="1.5" />
      <path d="M8 4.8v3.6" />
      <circle cx="8" cy="10.9" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `tg-icon ${className}` : 'tg-icon'}
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
