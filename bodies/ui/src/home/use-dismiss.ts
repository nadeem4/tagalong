/**
 * Closes a popup on Escape (and gives focus back to its button) or a press outside it and its
 * button. Contains useDismiss.
 */
import { useEffect, type RefObject } from 'react';

export function useDismiss(
  open: boolean,
  inside: RefObject<Element | null>[],
  button: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      onClose();
      button.current?.focus();
    };
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (inside.some((ref) => ref.current?.contains(target))) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, inside, button, onClose]);
}
