/**
 * The frame both pairing dialogs share: the scrim, the titled dialog, and Escape to close.
 * Contains PairShell.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export function PairShell({
  title,
  label = title,
  onClose,
  children,
}: {
  title: string;
  /** The dialog's accessible name when the heading changes as the dialog moves on. */
  label?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="pair-scrim">
      <div className="pair-dialog" role="dialog" aria-modal="true" aria-label={label}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
