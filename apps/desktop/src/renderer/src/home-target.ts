import type { HomePage } from '@tagalong/ui';

/**
 * What main names when it opens Home: a page, and for Settings a section to scroll to
 * (`settings#voice`, from a Fix it). Main has already checked it against its allowlist.
 */
export function homeTarget(raw: string): { page: HomePage; section?: string } {
  const [page = '', section] = raw.split('#');
  return page === 'settings' && section !== undefined && section !== ''
    ? { page: 'settings', section }
    : { page: page as HomePage };
}

/** Scrolls the Settings section with this id into view; false when it is not rendered yet. */
export function scrollToSection(
  doc: {
    getElementById(id: string): { scrollIntoView(options: ScrollIntoViewOptions): void } | null;
  },
  id: string,
): boolean {
  const section = doc.getElementById(id);
  if (section === null) return false;
  section.scrollIntoView({ block: 'start' });
  return true;
}
