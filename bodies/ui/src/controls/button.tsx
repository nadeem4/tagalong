/**
 * Button: one button with four looks (primary, secondary, quiet, danger). Defaults to
 * type=button so a button inside a form never submits it by accident.
 */
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export function Button({
  variant,
  className,
  type = 'button',
  ...rest
}: { variant: ButtonVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = ['tg-button', `tg-button--${variant}`, className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...rest} />;
}
