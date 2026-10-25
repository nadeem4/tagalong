/**
 * Bean's figure, built once from the strips in ./bean and shared by the dock, Home and
 * Welcome. Wiring only: the rules live in bean-figure.ts. Contains FIGURE.
 */
import { beanFigure } from './bean-figure';
import manifest from './bean/manifest.json';

/**
 * Bean's strips, emitted by Vite as files of their own, one hashed copy every window shares:
 * the windows' CSP (`default-src 'self'`) blocks the data: URL a small file would otherwise be
 * inlined as.
 */
export const FIGURE = beanFigure(
  manifest,
  import.meta.glob<string>('./bean/*.webp', {
    eager: true,
    query: '?url&no-inline',
    import: 'default',
  }),
);
