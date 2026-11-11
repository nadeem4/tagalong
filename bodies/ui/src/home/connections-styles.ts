/**
 * The Connections page's sheet: rows (tile, text, actions), chips, the check card, search, the
 * outcome and progress lines, and the add-it-yourself form. Sizes and weights are exactly the
 * type roles (26, 20, 16, 14, 13, 12, 11 and 400 or 600) so the type system maps onto them one
 * to one. Colours come from the tokens; a few literals wait for the token pass.
 * Scoped under `.home` so it outranks the card's own paragraph rules. Contains CONNECTIONS_CSS.
 */
import { themeTokens as t, typeCss } from '../theme/tokens';

// No token yet for the check card's border or the Recommended chip.
const WARN_LINE = '#EED79A';
const REC_FILL = '#DCE4FA';
const REC_INK = '#24326B';

export const CONNECTIONS_CSS = `
.home .cx-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.home .cx-item { border-top: 1px solid ${t.color.panelLine}; }
.home .cx-list > .cx-item:first-child { border-top: 0; }
.home .cx-row {
  display: grid; grid-template-columns: 36px 1fr auto; gap: 4px 14px; align-items: center; padding: 14px 0;
}
.home .cx-list > .cx-item:first-child > .cx-row { padding-top: 4px; }
.home .cx-row--top { align-items: start; }
.home .cx-tile {
  width: 36px; height: 36px; border-radius: 10px; background: ${t.color.panelTile}; color: ${t.color.panelText};
  display: grid; place-items: center; ${typeCss('bodyLead')}; font-weight: 600;
}
.home .cx-row__main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.home .cx-row__name {
  display: flex; align-items: center; gap: 8px; min-width: 0;
  ${typeCss('bodyLead')}; font-weight: 600; color: ${t.color.panelText};
}
/* The name gives way (an ellipsis) so its chips never wrap onto a line of their own. */
.home .cx-row__name > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.home .cx-row__desc {
  color: ${t.color.panelText}; ${typeCss('body')}; max-width: 62ch; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.home .cx-meta { color: ${t.color.panelMuted}; ${typeCss('small')}; }
.home .cx-row__side { display: flex; align-items: center; gap: 12px; justify-self: end; flex-wrap: wrap; justify-content: flex-end; }
.home .cx-row__note { padding: 0 0 10px 50px; }
.home .cx-fixed { min-width: 72px; }
.home .cx-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 20px; padding: 0 8px; border-radius: 10px;
  ${typeCss('caption')}; flex: none; white-space: nowrap;
  background: ${t.color.panelTile}; color: ${t.color.chipFreeInk};
}
.home .cx-chip--official { background: ${t.color.okFill}; color: ${t.color.okInk}; }
.home .cx-chip--rec { background: ${REC_FILL}; color: ${REC_INK}; }
.home .cx-chip--quiet { background: transparent; color: ${t.color.panelMuted}; border: 1px solid ${t.color.panelLine}; }
.home .cx-status {
  display: inline-flex; align-items: center; gap: 6px; ${typeCss('small')}; font-weight: 600;
  color: ${t.color.okInk}; white-space: nowrap;
}
.home .cx-status--off { color: ${t.color.panelMuted}; }
.home .cx-group-label { margin: 4px 0 6px; color: ${t.color.panelMuted}; ${typeCss('small')}; font-weight: 600; }
.home .cx-icon { width: 16px; height: 16px; flex: none; }
.home .cx-more {
  display: inline-flex; align-items: center; gap: 6px; margin: 0 0 6px 50px; padding: 2px 0; border: 0; background: none;
  font: inherit; ${typeCss('small')}; font-weight: 600; color: ${t.color.panelMuted}; cursor: pointer;
}
.home .cx-others {
  margin: 6px 0 0 50px; padding-left: 14px; border-left: 1px solid ${t.color.panelLine}; list-style: none;
  display: flex; flex-direction: column;
}
.home .cx-others .cx-row { grid-template-columns: 1fr auto; padding: 12px 0; }
.home .cx-others .cx-tile { display: none; }

.home .cx-check {
  margin: 4px 0 10px; padding: 14px 16px; border-radius: 10px; background: ${t.color.warnFill};
  border: 1px solid ${WARN_LINE}; color: ${t.color.warnInk}; display: flex; flex-direction: column; gap: 10px;
}
.home .cx-check__title {
  display: flex; align-items: center; gap: 8px; margin: 0; color: ${t.color.warnInk};
  ${typeCss('bodyLead')}; font-weight: 600;
}
.home .cx-check__facts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; ${typeCss('body')}; }
.home .cx-check__lead { color: ${t.color.panelText}; ${typeCss('bodyLead')}; font-weight: 600; }
.home .cx-check__foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.home .cx-check__foot p { flex: 1 1 260px; margin: 0; color: ${t.color.warnInk}; ${typeCss('small')}; }
.home .cx-check .tg-button--secondary { background: transparent; border-color: rgba(92, 70, 0, .35); color: ${t.color.warnInk}; }
.home .cx-link {
  display: inline-flex; align-items: center; gap: 4px; color: ${t.color.link}; font-weight: 600;
  text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px;
}
.home .cx-check .cx-link { color: ${t.color.warnInk}; }

.home .cx-search { display: flex; flex-direction: column; gap: 6px; }
.home .cx-search__box {
  display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; border-radius: 8px;
  border: 1px solid ${t.color.keycapLine}; background: #fff; color: ${t.color.panelMuted};
}
.home .cx-search__box input {
  flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; padding: 0;
  font: inherit; ${typeCss('bodyLead')}; color: ${t.color.panelText};
}
.home .cx-search__box:focus-within { outline: 2px solid var(--tg-focus); outline-offset: 2px; }
.home .cx-search__status { min-height: 20px; margin: 0; ${typeCss('small')}; }
.home .cx-search__note { color: ${t.color.panelMuted}; font-weight: 600; }
.home .cx-stale { opacity: .45; }

.home .cx-outcome {
  display: inline-flex; align-items: center; gap: 6px; ${typeCss('body')}; font-weight: 600;
  color: ${t.color.okInk};
}
.home .cx-outcome--err { color: ${t.color.errInk}; }
.home .cx-waiting {
  display: inline-flex; align-items: center; gap: 8px; ${typeCss('body')}; font-weight: 600;
  color: ${t.color.panelMuted}; white-space: nowrap;
}
.home .cx-spin {
  width: 14px; height: 14px; flex: none; border-radius: 50%;
  border: 2px solid ${t.color.panelLine}; border-top-color: ${t.color.panelText}; animation: cx-spin 900ms linear infinite;
}
@keyframes cx-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .home .cx-spin { animation: none; border-top-color: ${t.color.panelMuted}; } }
.home .cx-progress { display: flex; flex-direction: column; gap: 6px; width: 200px; }
.home .cx-progress__top { display: flex; justify-content: space-between; ${typeCss('small')}; font-weight: 600; color: ${t.color.panelText}; }
.home .cx-bar { height: 4px; border-radius: 2px; background: ${t.color.panelTile}; overflow: hidden; }
.home .cx-bar > i { display: block; height: 100%; background: ${t.color.panelText}; border-radius: 2px; }
.home .cx-errline {
  display: flex; align-items: center; gap: 8px; margin: 0 0 12px 50px; padding: 10px 12px; border-radius: 8px;
  background: ${t.color.errFill}; color: ${t.color.errInk}; ${typeCss('body')}; font-weight: 600;
}
.home .cx-errline .tg-button { margin-left: auto; }

.home .cx-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-top: 4px; }
.home .cx-foot__more { display: inline-flex; align-items: center; gap: 12px; }
.home .cx-foot__note { margin-left: auto; }
.home .cx-linkbtn {
  display: inline-flex; align-items: center; gap: 4px; margin-left: auto; padding: 0; border: 0; background: none;
  font: inherit; ${typeCss('body')}; font-weight: 600; color: ${t.color.link}; cursor: pointer;
}
.home .cx-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 20px 0 8px; }
.home .cx-empty p { margin: 0; ${typeCss('body')}; color: ${t.color.panelMuted}; }
.home .cx-empty .cx-empty__lead { ${typeCss('bodyLead')}; font-weight: 600; color: ${t.color.panelText}; }

.home .cx-form { display: flex; flex-direction: column; gap: 16px; padding: 16px 0 0; border-top: 1px solid ${t.color.panelLine}; }
.home .cx-form__head { display: flex; flex-direction: column; gap: 2px; }
.home .cx-form__title { margin: 0; ${typeCss('bodyLead')}; font-weight: 600; color: ${t.color.panelText}; }
.home .cx-form__lead { margin: 0; ${typeCss('body')}; color: ${t.color.panelMuted}; }
.home .cx-form__hint { margin: 0; ${typeCss('small')}; color: ${t.color.panelMuted}; }
.home .cx-seg {
  display: inline-flex; align-self: flex-start; gap: 3px; padding: 3px; border-radius: 10px; background: ${t.color.panelTile};
}
.home .cx-seg button {
  height: 30px; padding: 0 14px; border: 0; border-radius: 7px; background: transparent; cursor: pointer;
  font: inherit; ${typeCss('body')}; font-weight: 600; color: ${t.color.panelMuted};
}
.home .cx-seg button[aria-checked='true'] { background: #fff; color: ${t.color.panelText}; box-shadow: 0 1px 2px rgba(18, 22, 43, .12); }
.home .cx-seg button:focus-visible { outline: 2px solid var(--tg-focus); outline-offset: 2px; }
.home .cx-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.home .cx-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.home .cx-field__lbl { ${typeCss('small')}; font-weight: 600; color: ${t.color.panelText}; }
.home .cx-field__hint { ${typeCss('small')}; color: ${t.color.panelMuted}; }
.home .cx-input {
  height: 36px; width: 100%; box-sizing: border-box; padding: 0 12px; border: 1px solid ${t.color.keycapLine}; border-radius: 8px;
  background: #fff; font: inherit; ${typeCss('bodyLead')}; color: ${t.color.panelText};
}
.home .cx-input::placeholder { color: ${t.color.panelMuted}; }
.home .cx-input:focus-visible { outline: 2px solid var(--tg-focus); outline-offset: 2px; }
.home .cx-input--code, .home .cx-input--area, .home .cx-code {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; ${typeCss('body')};
}
.home .cx-input--area { height: auto; min-height: 72px; padding: 8px 12px; resize: vertical; white-space: pre; }
.home .cx-code { ${typeCss('small')}; background: ${t.color.panelTile}; padding: 1px 5px; border-radius: 4px; color: ${t.color.panelText}; }
.home .cx-form__actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
`;
