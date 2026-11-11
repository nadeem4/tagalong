/**
 * The small i button beside a permission's name and the text it opens. The text drops in below
 * the whole row (it portals into the row's list item) so it can use the full width. Escape or a
 * click elsewhere closes it and focus goes back to the button. Contains InfoPopover.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function InfoPopover({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const [host, setHost] = useState<Element | null>(null);

  useEffect(() => {
    setHost(open ? (button.current?.closest('li') ?? null) : null);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (pop.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const body = (
    <div ref={pop} id={id} role="dialog" aria-label={`About ${label}`} className="perm-pop">
      {text}
    </div>
  );

  return (
    <>
      <button
        ref={button}
        type="button"
        className="perm-info"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        i
      </button>
      {open && (host ? createPortal(body, host) : body)}
    </>
  );
}
