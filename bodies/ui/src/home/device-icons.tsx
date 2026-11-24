/**
 * The line icons on Devices rows: a computer, a laptop, a browser, an AI tool's terminal and
 * a phone. 16px strokes in the current colour, as in the mockup. Contains DeviceIcon.
 */
import type { ReactElement } from 'react';

const PATHS = {
  pc: (
    <>
      <rect x="2" y="2.5" width="12" height="8" rx="1.4" />
      <path d="M6 13.5h4M8 10.5v3" />
    </>
  ),
  laptop: (
    <>
      <rect x="3" y="3" width="10" height="7" rx="1.2" />
      <path d="M1.5 12.5h13" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2 1.8 2 10.2 0 12M8 2c-2 1.8-2 10.2 0 12" />
    </>
  ),
  term: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <path d="m5 7 2 1.5L5 10M8.5 10.5H11" />
    </>
  ),
  phone: (
    <>
      <rect x="4.5" y="1.8" width="7" height="12.4" rx="1.6" />
      <path d="M7 12h2" />
    </>
  ),
} satisfies Record<string, ReactElement>;

export type DeviceIconName = keyof typeof PATHS;

export function DeviceIcon({ name }: { name: DeviceIconName }) {
  return (
    <svg
      className="dv-icon"
      viewBox="0 0 16 16"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
