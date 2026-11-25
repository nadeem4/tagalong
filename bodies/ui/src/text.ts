/**
 * Small text helpers the screens share: a capitalised first letter and a short date.
 * Contains cap and shortDate.
 */

export const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** "Nov 24", in the person's own language and order. */
export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
