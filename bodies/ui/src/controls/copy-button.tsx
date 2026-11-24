/**
 * CopyButton: a button that copies one piece of text through the host. A failed copy costs
 * nothing: the text is on screen to select by hand. Contains CopyButton.
 */
import type { ReactNode } from 'react';
import { Button, type ButtonVariant } from './button';

export function CopyButton({
  text,
  copy,
  variant = 'secondary',
  disabled = false,
  label,
  children = 'Copy',
}: {
  text: string;
  copy: (text: string) => Promise<void>;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** The accessible name when the visible word alone does not say what is copied. */
  label?: string;
  children?: ReactNode;
}) {
  return (
    <Button
      variant={variant}
      disabled={disabled}
      aria-label={label}
      onClick={() => void copy(text).catch(() => undefined)}
    >
      {children}
    </Button>
  );
}
