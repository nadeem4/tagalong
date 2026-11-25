/**
 * The rows of Home's "Needs you on this PC" and "Approved on this PC": a title and its facts,
 * then buttons.
 */
import { themeTokens as t, themedColor, typeCss } from '../theme/tokens';

export const NEEDS_CSS = `
.home .needs-row { display: flex; align-items: center; gap: ${t.space.lg}px; padding: ${t.space.md}px 0; flex-wrap: wrap; }
.home .needs-row__body { flex: 1 1 240px; min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.home .needs-row__title { ${typeCss('body')}; font-weight: ${t.fontWeight.semibold}; color: ${themedColor.panelText}; overflow-wrap: anywhere; }
.home .needs-row__act { display: flex; gap: ${t.space.md}px; }
`;
