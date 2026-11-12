/**
 * The sheet for the get-to-know-me form and result view. It sits on the light page (a card or the
 * tour) and uses the shared tokens and the controls' CSS variables, so it needs no theme of its
 * own. Contains KNOW_ME_CSS.
 */
import { themeTokens as t, typeCss } from '../theme/tokens';

export const KNOW_ME_CSS = `
.know { display: flex; flex-direction: column; gap: ${t.space.xl}px; color: ${t.color.panelText}; font-family: ${t.font.ui}; }
.know__head { display: flex; align-items: center; gap: ${t.space.lg}px; }
.know__head .scout-mark { flex: none; }
.know__title { margin: 0; ${typeCss('heading')}; text-wrap: balance; }
.know__title:focus { outline: none; }
.know__sub { margin: 0; color: ${t.color.panelMuted}; ${typeCss('body')}; }

/* The portrait is the point of the screen: a quiet well, the text at reading width. */
.know__portrait {
  padding: ${t.space.xl}px ${t.space.xxl}px; background: ${t.color.panel};
  border: 1px solid ${t.color.panelLine}; border-radius: ${t.radius.card}px;
}
.know__portrait p { margin: 0; max-width: 62ch; ${typeCss('bodyLead')}; overflow-wrap: anywhere; }
.know__portrait p + p { margin-top: ${t.space.lg}px; }
.know__none { margin: 0; ${typeCss('bodyLead')}; }

.know__gaps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${t.space.sm}px; }
.know__gaps li {
  padding: ${t.space.sm}px ${t.space.md}px; background: ${t.color.warnFill}; color: ${t.color.warnInk};
  border: 1px solid ${t.color.warnLine}; border-radius: ${t.radius.sm}px; ${typeCss('small')};
}
.know__actions { display: flex; flex-wrap: wrap; gap: ${t.space.md}px; }

.know__filters { display: flex; flex-wrap: wrap; gap: ${t.space.sm}px; }
.know__filter {
  height: 36px; padding: 0 ${t.space.lg}px; border: 1px solid ${t.color.panelLine}; border-radius: ${t.radius.pill}px;
  background: ${t.color.controlFill}; color: ${t.color.chipFreeInk}; cursor: pointer;
  font-family: ${t.font.ui}; ${typeCss('small')}; font-variant-numeric: tabular-nums;
}
.know__filter:hover { border-color: ${t.color.panelMuted}; }
.know__filter[aria-pressed='true'] { background: ${t.color.gold}; border-color: ${t.color.gold}; color: ${t.color.goldInk}; font-weight: ${t.fontWeight.semibold}; }
.know__filter:focus-visible, .know__field input:focus-visible {
  outline: ${t.size.focusRing}px solid var(--tg-focus); outline-offset: ${t.size.focusOffset}px;
}

.know__facts { list-style: none; margin: 0; padding: 0; max-height: 50vh; overflow-y: auto; }
.know__fact {
  display: flex; justify-content: space-between; align-items: flex-start; gap: ${t.space.lg}px;
  padding: ${t.space.lg}px 0; border-top: 1px solid ${t.color.panelLine};
}
.know__fact:first-child { border-top: 0; }
.know__fact-text { min-width: 0; ${typeCss('bodyLead')}; overflow-wrap: anywhere; }
.know__quote { display: block; margin-top: ${t.space.xxs}px; color: ${t.color.panelMuted}; ${typeCss('small')}; }
.know__meta { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: ${t.space.xs}px; flex: none; }
.know__chip {
  padding: ${t.space.xxs}px ${t.space.md}px; border-radius: ${t.radius.pill}px; white-space: nowrap;
  background: ${t.color.chipFree}; color: ${t.color.chipFreeInk}; ${typeCss('caption')};
}
.know__chip--asked { background: ${t.color.warnFill}; color: ${t.color.warnInk}; }

.know__form { display: flex; flex-direction: column; gap: ${t.space.xl}px; }
.know__field { display: flex; flex-direction: column; gap: ${t.space.xs}px; min-width: 0; }
.know__label { ${typeCss('body')}; font-weight: ${t.fontWeight.semibold}; }
.know__field input[type='text'] {
  box-sizing: border-box; width: 100%; height: ${t.size.fieldHeight}px; padding: 0 ${t.space.lg}px;
  border: 1px solid var(--tg-ctl-line); border-radius: ${t.radius.sm}px; background: var(--tg-ctl-bg);
  color: var(--tg-ctl-ink); font-family: ${t.font.ui}; ${typeCss('bodyLead')};
}
.know__field input[type='file'] { max-width: 100%; color: ${t.color.panelMuted}; font-family: ${t.font.ui}; ${typeCss('body')}; }
.know__field input[type='file']::file-selector-button {
  height: ${t.size.control}px; margin-right: ${t.space.lg}px; padding: 0 ${t.space.xl}px; cursor: pointer;
  border: 1px solid var(--tg-ctl-line); border-radius: ${t.radius.sm}px; background: var(--tg-ctl-bg);
  color: var(--tg-ctl-ink); font-family: ${t.font.ui}; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold};
}
.know__hint { margin: 0; color: ${t.color.panelMuted}; ${typeCss('small')}; }
.know__error { margin: 0; color: ${t.color.errInk}; ${typeCss('body')}; font-weight: ${t.fontWeight.semibold}; }

.know__progress { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${t.space.lg}px; }
.know__row { display: grid; grid-template-columns: 10px minmax(0, 1fr); column-gap: ${t.space.lg}px; align-items: start; ${typeCss('bodyLead')}; }
.know__dot { width: 10px; height: 10px; margin-top: ${t.space.xs}px; border-radius: 50%; border: 2px solid ${t.color.disabledChev}; box-sizing: border-box; }
.know__row[data-state='reading'] .know__dot { background: ${t.color.gold}; border-color: ${t.color.gold}; animation: know-pulse 1.2s ease-in-out infinite; }
.know__row[data-state='done'] .know__dot { background: ${t.color.okDot}; border-color: ${t.color.okDot}; }
.know__row[data-state='failed'] .know__dot { background: ${t.color.warnBar}; border-color: ${t.color.warnBar}; }
.know__row-gap { grid-column: 2; color: ${t.color.panelMuted}; ${typeCss('small')}; }
@keyframes know-pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .know__row[data-state='reading'] .know__dot { animation: none; } }
`;
