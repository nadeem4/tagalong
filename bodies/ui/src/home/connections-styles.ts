/**
 * The Connections page's sheet: rows (tile, text, actions), chips, the check card, search, the
 * outcome and progress lines, and the add-it-yourself form. Sizes and weights are exactly the
 * type roles (26, 20, 16, 14, 13, 12, 11 and 400 or 600) so the type system maps onto them one
 * to one. Colours come from the tokens; a few literals wait for the token pass.
 * Scoped under `.home` (and the tour, `.wt`, which reuses the rows) so it outranks the card's own paragraph rules. Contains CONNECTIONS_CSS.
 */
import { themeTokens as t, typeCss } from '../theme/tokens';

// No token yet for the check card's border or the Recommended chip.
const WARN_LINE = '#EED79A';
const REC_FILL = '#DCE4FA';
const REC_INK = '#24326B';

export const CONNECTIONS_CSS = `
:is(.home, .wt) .cx-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
:is(.home, .wt) .cx-item { border-top: 1px solid ${t.color.panelLine}; }
:is(.home, .wt) .cx-list > .cx-item:first-child { border-top: 0; }
:is(.home, .wt) .cx-row {
  display: grid; grid-template-columns: 36px 1fr auto; gap: 4px 14px; align-items: center; padding: 14px 0;
}
:is(.home, .wt) .cx-list > .cx-item:first-child > .cx-row { padding-top: 4px; }
:is(.home, .wt) .cx-row--top { align-items: start; }
:is(.home, .wt) .cx-tile {
  width: 36px; height: 36px; border-radius: 10px; background: ${t.color.panelTile}; color: ${t.color.panelText};
  display: grid; place-items: center; ${typeCss('bodyLead')}; font-weight: 600;
}
:is(.home, .wt) .cx-row__main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
:is(.home, .wt) .cx-row__name {
  display: flex; align-items: center; gap: 8px; min-width: 0;
  ${typeCss('bodyLead')}; font-weight: 600; color: ${t.color.panelText};
}
/* The name gives way (an ellipsis) so its chips never wrap onto a line of their own. */
:is(.home, .wt) .cx-row__name > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
:is(.home, .wt) .cx-row__desc {
  color: ${t.color.panelText}; ${typeCss('body')}; max-width: 62ch; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
:is(.home, .wt) .cx-meta { color: ${t.color.panelMuted}; ${typeCss('small')}; }
:is(.home, .wt) .cx-row__side { display: flex; align-items: center; gap: 12px; justify-self: end; flex-wrap: wrap; justify-content: flex-end; }
:is(.home, .wt) .cx-row__note { padding: 0 0 10px 50px; }
:is(.home, .wt) .cx-fixed { min-width: 72px; }
:is(.home, .wt) .cx-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 20px; padding: 0 8px; border-radius: 10px;
  ${typeCss('caption')}; flex: none; white-space: nowrap;
  background: ${t.color.panelTile}; color: ${t.color.chipFreeInk};
}
:is(.home, .wt) .cx-chip--official { background: ${t.color.okFill}; color: ${t.color.okInk}; }
:is(.home, .wt) .cx-chip--rec { background: ${REC_FILL}; color: ${REC_INK}; }
:is(.home, .wt) .cx-chip--quiet { background: transparent; color: ${t.color.panelMuted}; border: 1px solid ${t.color.panelLine}; }
:is(.home, .wt) .cx-status {
  display: inline-flex; align-items: center; gap: 6px; ${typeCss('small')}; font-weight: 600;
  color: ${t.color.okInk}; white-space: nowrap;
}
:is(.home, .wt) .cx-status--off { color: ${t.color.panelMuted}; }
:is(.home, .wt) .cx-status--warn { color: ${t.color.warnInk}; }
:is(.home, .wt) .cx-card-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
:is(.home, .wt) .cx-card-tools { display: flex; align-items: center; gap: 8px; }
:is(.home, .wt) .cx-auto { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 10px; background: ${t.color.panel}; }
:is(.home, .wt) .cx-auto__row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
:is(.home, .wt) .cx-auto__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
:is(.home, .wt) .cx-auto__text > span:first-child { ${typeCss('body')}; font-weight: 600; color: ${t.color.panelText}; }
:is(.home, .wt) .cx-panel { display: flex; flex-direction: column; gap: 20px; }
:is(.home, .wt) .cx-quiet { display: inline-flex; align-items: center; gap: 2px; }
:is(.home, .wt) .cx-quiet .tg-button { padding: 0 8px; }
:is(.home, .wt) .cx-grp-note { margin: -2px 0 0; color: ${t.color.panelMuted}; ${typeCss('small')}; }
:is(.home, .wt) .cx-group-label { margin: 8px 0 -6px; color: ${t.color.panelMuted}; ${typeCss('small')}; font-weight: 600; }
:is(.home, .wt) .cx-icon { width: 16px; height: 16px; flex: none; }
:is(.home, .wt) .cx-more {
  display: inline-flex; align-items: center; gap: 6px; margin: 0 0 6px 50px; padding: 2px 0; border: 0; background: none;
  font: inherit; ${typeCss('small')}; font-weight: 600; color: ${t.color.panelMuted}; cursor: pointer;
}
:is(.home, .wt) .cx-others {
  margin: 6px 0 0 50px; padding-left: 14px; border-left: 1px solid ${t.color.panelLine}; list-style: none;
  display: flex; flex-direction: column;
}
:is(.home, .wt) .cx-others .cx-row { grid-template-columns: 1fr auto; padding: 12px 0; }
:is(.home, .wt) .cx-others .cx-tile { display: none; }

:is(.home, .wt) .cx-check {
  margin: 4px 0 10px; padding: 14px 16px; border-radius: 10px; background: ${t.color.warnFill};
  border: 1px solid ${WARN_LINE}; color: ${t.color.warnInk}; display: flex; flex-direction: column; gap: 10px;
}
:is(.home, .wt) .cx-check__title {
  display: flex; align-items: center; gap: 8px; margin: 0; color: ${t.color.warnInk};
  ${typeCss('bodyLead')}; font-weight: 600;
}
:is(.home, .wt) .cx-check__facts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; ${typeCss('body')}; }
:is(.home, .wt) .cx-check__lead { color: ${t.color.panelText}; ${typeCss('bodyLead')}; font-weight: 600; }
:is(.home, .wt) .cx-check__foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
:is(.home, .wt) .cx-check__foot p { flex: 1 1 260px; margin: 0; color: ${t.color.warnInk}; ${typeCss('small')}; }
:is(.home, .wt) .cx-check .tg-button--secondary { background: transparent; border-color: rgba(92, 70, 0, .35); color: ${t.color.warnInk}; }
:is(.home, .wt) .cx-link {
  display: inline-flex; align-items: center; gap: 4px; color: ${t.color.link}; font-weight: 600;
  text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px;
}
:is(.home, .wt) .cx-check .cx-link { color: ${t.color.warnInk}; }

:is(.home, .wt) .cx-section { display: flex; flex-direction: column; gap: 14px; }
:is(.home, .wt) .cx-search { display: flex; flex-direction: column; gap: 0; }
:is(.home, .wt) .cx-search__status:not(:empty) { margin-top: 6px; }
:is(.home, .wt) .cx-search__box {
  display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; border-radius: 8px;
  border: 1px solid ${t.color.keycapLine}; background: #fff; color: ${t.color.panelMuted};
}
:is(.home, .wt) .cx-search__box input {
  flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; padding: 0;
  font: inherit; ${typeCss('bodyLead')}; color: ${t.color.panelText};
}
:is(.home, .wt) .cx-search__box:focus-within { outline: 2px solid var(--tg-focus); outline-offset: 2px; }
:is(.home, .wt) .cx-search__status { margin: 0;${typeCss('small')}; }
:is(.home, .wt) .cx-search__note { color: ${t.color.panelMuted}; font-weight: 600; }
:is(.home, .wt) .cx-stale { opacity: .45; }

:is(.home, .wt) .cx-outcome {
  display: inline-flex; align-items: center; gap: 6px; ${typeCss('body')}; font-weight: 600;
  color: ${t.color.okInk};
}
:is(.home, .wt) .cx-outcome--err { color: ${t.color.errInk}; }
:is(.home, .wt) .cx-waiting {
  display: inline-flex; align-items: center; gap: 8px; ${typeCss('body')}; font-weight: 600;
  color: ${t.color.panelMuted}; white-space: nowrap;
}
:is(.home, .wt) .cx-spin {
  width: 14px; height: 14px; flex: none; border-radius: 50%;
  border: 2px solid ${t.color.panelLine}; border-top-color: ${t.color.panelText}; animation: cx-spin 900ms linear infinite;
}
@keyframes cx-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { :is(.home, .wt) .cx-spin { animation: none; border-top-color: ${t.color.panelMuted}; } }
:is(.home, .wt) .cx-progress { display: flex; flex-direction: column; gap: 6px; width: 200px; }
:is(.home, .wt) .cx-progress__top { display: flex; justify-content: space-between; ${typeCss('small')}; font-weight: 600; color: ${t.color.panelText}; }
:is(.home, .wt) .cx-bar { height: 4px; border-radius: 2px; background: ${t.color.panelTile}; overflow: hidden; }
:is(.home, .wt) .cx-bar > i { display: block; height: 100%; background: ${t.color.panelText}; border-radius: 2px; }
:is(.home, .wt) .cx-item > .sc { margin: 0 0 12px 50px; }
:is(.home, .wt) .cx-errline {
  display: flex; align-items: center; gap: 8px; margin: 0 0 12px 50px; padding: 10px 12px; border-radius: 8px;
  background: ${t.color.errFill}; color: ${t.color.errInk}; ${typeCss('body')}; font-weight: 600;
}
:is(.home, .wt) .cx-errline .tg-button { margin-left: auto; }

:is(.home, .wt) .cx-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-top: 4px; }
:is(.home, .wt) .cx-foot__more { display: inline-flex; align-items: center; gap: 12px; }
:is(.home, .wt) .cx-foot__note { margin-left: auto; }
:is(.home, .wt) .cx-linkbtn {
  display: inline-flex; align-items: center; gap: 4px; margin-left: auto; padding: 0; border: 0; background: none;
  font: inherit; ${typeCss('body')}; font-weight: 600; color: ${t.color.link}; cursor: pointer;
}
:is(.home, .wt) .cx-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 20px 0 8px; }
:is(.home, .wt) .cx-empty p { margin: 0; ${typeCss('body')}; color: ${t.color.panelMuted}; }
:is(.home, .wt) .cx-empty .cx-empty__lead { ${typeCss('bodyLead')}; font-weight: 600; color: ${t.color.panelText}; }

:is(.home, .wt) .cx-form { display: flex; flex-direction: column; gap: 16px; padding: 16px 0 0; border-top: 1px solid ${t.color.panelLine}; }
:is(.home, .wt) .cx-form__head { display: flex; flex-direction: column; gap: 2px; }
:is(.home, .wt) .cx-form__title { margin: 0; ${typeCss('bodyLead')}; font-weight: 600; color: ${t.color.panelText}; }
:is(.home, .wt) .cx-form__lead { margin: 0; ${typeCss('body')}; color: ${t.color.panelMuted}; }
:is(.home, .wt) .cx-form__hint { margin: 0; ${typeCss('small')}; color: ${t.color.panelMuted}; }
:is(.home, .wt) .cx-seg {
  display: inline-flex; align-self: flex-start; gap: 3px; padding: 3px; border-radius: 10px; background: ${t.color.panelTile};
}
:is(.home, .wt) .cx-seg button {
  height: 30px; padding: 0 14px; border: 0; border-radius: 7px; background: transparent; cursor: pointer;
  font: inherit; ${typeCss('body')}; font-weight: 600; color: ${t.color.panelMuted};
}
:is(.home, .wt) .cx-seg button[aria-checked='true'] { background: #fff; color: ${t.color.panelText}; box-shadow: 0 1px 2px rgba(18, 22, 43, .12); }
:is(.home, .wt) .cx-seg button:focus-visible { outline: 2px solid var(--tg-focus); outline-offset: 2px; }
:is(.home, .wt) .cx-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
:is(.home, .wt) .cx-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
:is(.home, .wt) .cx-field__lbl { ${typeCss('small')}; font-weight: 600; color: ${t.color.panelText}; }
:is(.home, .wt) .cx-field__hint { ${typeCss('small')}; color: ${t.color.panelMuted}; }
:is(.home, .wt) .cx-input {
  height: 36px; width: 100%; box-sizing: border-box; padding: 0 12px; border: 1px solid ${t.color.keycapLine}; border-radius: 8px;
  background: #fff; font: inherit; ${typeCss('bodyLead')}; color: ${t.color.panelText};
}
:is(.home, .wt) .cx-input::placeholder { color: ${t.color.panelMuted}; }
:is(.home, .wt) .cx-input:focus-visible { outline: 2px solid var(--tg-focus); outline-offset: 2px; }
:is(.home, .wt) .cx-input--code, :is(.home, .wt) .cx-input--area, :is(.home, .wt) .cx-code {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; ${typeCss('body')};
}
:is(.home, .wt) .cx-input--area { height: auto; min-height: 72px; padding: 8px 12px; resize: vertical; white-space: pre; }
:is(.home, .wt) .cx-code { ${typeCss('small')}; background: ${t.color.panelTile}; padding: 1px 5px; border-radius: 4px; color: ${t.color.panelText}; }
:is(.home, .wt) .cx-form__actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
`;
