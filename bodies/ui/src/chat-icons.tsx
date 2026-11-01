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
