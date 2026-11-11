/**
 * The small drawn icons of the chat window (close, back to the bubble), so its buttons are
 * pictures with real names rather than characters. Contains CloseIcon and CollapseIcon.
 */
import type { ReactNode } from 'react';

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const CloseIcon = () => (
  <Glyph>
    <path d="M6 6l12 12M18 6L6 18" />
  </Glyph>
);

export const CollapseIcon = () => (
  <Glyph>
    <path d="M14 10l6-6M14 4v6h6M10 14l-6 6M4 14h6v6" />
  </Glyph>
);

/** The 18px header and composer glyphs, drawn on the mockup's 20-unit grid. */
function Glyph18({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none">
      {children}
    </svg>
  );
}
const STROKE = { stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' } as const;

export const MicIcon = ({ state }: { state: 'plain' | 'on' | 'off' }) => (
  <Glyph18>
    {state === 'on' ? (
      <rect x="7" y="2.5" width="6" height="10" rx="3" fill="currentColor" />
    ) : (
      <rect x="7" y="2.5" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.6" />
    )}
    <path
      d={`M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5${state === 'off' ? 'M3.5 3.5l13 13' : ''}`}
      {...STROKE}
    />
  </Glyph18>
);

export const EyeIcon = ({ on }: { on: boolean }) => (
  <Glyph18>
    <path
      d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10Z"
      fill={on ? 'currentColor' : 'none'}
      fillOpacity={on ? 0.22 : undefined}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    {on ? (
      <circle cx="10" cy="10" r="2.8" fill="currentColor" />
    ) : (
      <>
        <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.5 3.5l13 13" {...STROKE} />
      </>
    )}
  </Glyph18>
);

export const ExpandIcon = () => (
  <Glyph18>
    <path
      d="M11.5 3.5h5v5M16.5 3.5l-5.5 5.5M8.5 16.5h-5v-5M3.5 16.5 9 11"
      {...STROKE}
      strokeLinejoin="round"
    />
  </Glyph18>
);

export const SendIcon = () => (
  <Glyph18>
    <path
      d="M10 15.5v-11M5.5 9 10 4.5 14.5 9"
      {...STROKE}
      strokeWidth="1.9"
      strokeLinejoin="round"
    />
  </Glyph18>
);
