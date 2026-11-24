/**
 * The Connections page's sheet: rows (tile, text, actions), chips, the check card, search, the
 * outcome and progress lines, and the add-it-yourself form. Sizes and weights are exactly the
 * type roles (26, 20, 16, 14, 13, 12, 11 and 400 or 600) so the type system maps onto them one
 * to one.
 * Scoped under `.home` (and the tour, `.wt`, which reuses the rows) so it outranks the card's own paragraph rules. Contains CONNECTIONS_CSS.
 */
import { themeTokens as t, themedColor, typeCss } from '../theme/tokens';

export const CONNECTIONS_CSS = `
:is(.home, .wt) .cx-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
:is(.home, .wt) .cx-item { border-top: 1px solid ${themedColor.panelLine}; }
:is(.home, .wt) .cx-list > .cx-item:first-child { border-top: 0; }
:is(.home, .wt) .cx-row {
  display: grid; grid-template-columns: 36px 1fr auto; gap: 4px ${t.space.xl}px; align-items: center; padding: ${t.space.lg}px 0;
}
:is(.home, .wt) .cx-list > .cx-item:first-child > .cx-row { padding-top: 4px; }
:is(.home, .wt) .cx-row--top { align-items: start; }
:is(.home, .wt) .cx-tile {
  width: 36px; height: 36px; border-radius: ${t.radius.card}px; background: ${themedColor.panelTile}; color: ${themedColor.panelText};
  display: grid; place-items: center; ${typeCss('bodyLead')}; font-weight: 600;
}
:is(.home, .wt) .cx-row__main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
:is(.home, .wt) .cx-row__name {
  display: flex; align-items: center; gap: 8px; min-width: 0;
  ${typeCss('bodyLead')}; font-weight: 600; color: ${themedColor.panelText};
}
/* The name gives way (an ellipsis) so its chips never wrap onto a line of their own. */
:is(.home, .wt) .cx-row__name > span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
:is(.home, .wt) .cx-row__desc {
  color: ${themedColor.panelText}; ${typeCss('body')}; max-width: 62ch; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
:is(.home, .wt) .cx-meta { color: ${themedColor.panelMuted}; ${typeCss('small')}; }
:is(.home, .wt) .cx-row__side { display: flex; align-items: center; gap: 12px; justify-self: end; flex-wrap: wrap; justify-content: flex-end; }
:is(.home, .wt) .cx-row__note { padding: 0 0 ${t.space.md}px ${t.space.hero}px; }
:is(.home, .wt) .cx-fixed { min-width: 72px; }
:is(.home, .wt) .cx-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 20px; padding: 0 8px; border-radius: ${t.radius.card}px;
  ${typeCss('caption')}; flex: none; white-space: nowrap;
  background: ${themedColor.panelTile}; color: ${themedColor.chipFreeInk};
}
:is(.home, .wt) .cx-chip--official { background: ${themedColor.okFill}; color: ${themedColor.okInk}; }
:is(.home, .wt) .cx-chip--rec { background: ${themedColor.recFill}; color: ${themedColor.recInk}; }
:is(.home, .wt) .cx-chip--quiet { background: transparent; color: ${themedColor.panelMuted}; border: 1px solid ${themedColor.panelLine}; }
:is(.home, .wt) .cx-status {
  display: inline-flex; align-items: center; gap: 6px; ${typeCss('small')}; font-weight: 600;
  color: ${themedColor.okInk}; white-space: nowrap;
}
:is(.home, .wt) .cx-status--off { color: ${themedColor.panelMuted}; }
:is(.home, .wt) .cx-status--warn { color: ${themedColor.warnInk}; }
:is(.home, .wt) .cx-card-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
:is(.home, .wt) .cx-card-tools { display: flex; align-items: center; gap: 8px; }
:is(.home, .wt) .cx-auto { display: flex; flex-direction: column; gap: 8px; padding: 12px ${t.space.xl}px; border-radius: ${t.radius.card}px; background: ${themedColor.panel}; }
:is(.home, .wt) .cx-auto__row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
:is(.home, .wt) .cx-auto__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
:is(.home, .wt) .cx-auto__text > span:first-child { ${typeCss('body')}; font-weight: 600; color: ${themedColor.panelText}; }
:is(.home, .wt) .cx-panel { display: flex; flex-direction: column; gap: 20px; }
:is(.home, .wt) .cx-quiet { display: inline-flex; align-items: center; gap: 2px; }
:is(.home, .wt) .cx-quiet .tg-button { padding: 0 8px; }
:is(.home, .wt) .cx-grp-note { margin: -${t.space.xxs}px 0 0; color: ${themedColor.panelMuted}; ${typeCss('small')}; }
:is(.home, .wt) .cx-group-label { margin: 8px 0 -${t.space.sm}px; color: ${themedColor.panelMuted}; ${typeCss('small')}; font-weight: 600; }
:is(.home, .wt) .cx-icon { width: 16px; height: 16px; flex: none; }
:is(.home, .wt) .cx-more {
  display: inline-flex; align-items: center; gap: 6px; margin: 0 0 6px ${t.space.hero}px; padding: 2px 0; border: 0; background: none;
  font: inherit; ${typeCss('small')}; font-weight: 600; color: ${themedColor.panelMuted}; cursor: pointer;
}
:is(.home, .wt) .cx-others {
  margin: 6px 0 0 ${t.space.hero}px; padding-left: ${t.space.xl}px; border-left: 1px solid ${themedColor.panelLine}; list-style: none;
  display: flex; flex-direction: column;
}
:is(.home, .wt) .cx-others .cx-row { grid-template-columns: 1fr auto; padding: 12px 0; }
:is(.home, .wt) .cx-others .cx-tile { display: none; }

:is(.home, .wt) .cx-check {
  margin: 4px 0 ${t.space.md}px; padding: ${t.space.lg}px 16px; border-radius: ${t.radius.card}px; background: ${themedColor.warnFill};
  border: 1px solid ${themedColor.warnLine}; color: ${themedColor.warnInk}; display: flex; flex-direction: column; gap: ${t.space.lg}px;
}
:is(.home, .wt) .cx-check__title {
  display: flex; align-items: center; gap: 8px; margin: 0; color: ${themedColor.warnInk};
  ${typeCss('bodyLead')}; font-weight: 600;
}
:is(.home, .wt) .cx-check__facts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; ${typeCss('body')}; }
:is(.home, .wt) .cx-check__lead { color: ${themedColor.panelText}; ${typeCss('bodyLead')}; font-weight: 600; }
:is(.home, .wt) .cx-check__foot { display: flex; align-items: center; gap: ${t.space.lg}px; flex-wrap: wrap; }
:is(.home, .wt) .cx-check__foot p { flex: 1 1 260px; margin: 0; color: ${themedColor.warnInk}; ${typeCss('small')}; }
:is(.home, .wt) .cx-check .tg-button--secondary { background: transparent; border-color: ${themedColor.warnLine}; color: ${themedColor.warnInk}; }
:is(.home, .wt) .cx-link {
  display: inline-flex; align-items: center; gap: 4px; color: ${themedColor.link}; font-weight: 600;
  text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px;
}
:is(.home, .wt) .cx-check .cx-link { color: ${themedColor.warnInk}; }

:is(.home, .wt) .cx-section { display: flex; flex-direction: column; gap: ${t.space.xl}px; }
:is(.home, .wt) .cx-search { display: flex; flex-direction: column; gap: 0; }
:is(.home, .wt) .cx-search__status:not(:empty) { margin-top: 6px; }
:is(.home, .wt) .cx-search__box {
  display: flex; align-items: center; gap: ${t.space.lg}px; height: 40px; padding: 0 12px; border-radius: ${t.radius.sm}px;
  border: 1px solid ${themedColor.keycapLine}; background: ${themedColor.card}; color: ${themedColor.panelMuted};
}
:is(.home, .wt) .cx-search__box input {
  flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; padding: 0;
  font: inherit; ${typeCss('bodyLead')}; color: ${themedColor.panelText};
}
:is(.home, .wt) .cx-search__box:focus-within { outline: 2px solid var(--tg-focus); outline-offset: 2px; }
:is(.home, .wt) .cx-search__status { margin: 0;${typeCss('small')}; }
:is(.home, .wt) .cx-search__note { color: ${themedColor.panelMuted}; font-weight: 600; }
:is(.home, .wt) .cx-stale { opacity: .45; }

:is(.home, .wt) .cx-outcome {
  display: inline-flex; align-items: center; gap: 6px; ${typeCss('body')}; font-weight: 600;
  color: ${themedColor.okInk};
}
:is(.home, .wt) .cx-outcome--err { color: ${themedColor.errInk}; }
:is(.home, .wt) .cx-waiting {
  display: inline-flex; align-items: center; gap: 8px; ${typeCss('body')}; font-weight: 600;
  color: ${themedColor.panelMuted}; white-space: nowrap;
}
:is(.home, .wt) .cx-spin {
  width: 14px; height: 14px; flex: none; border-radius: 50%;
  border: 2px solid ${themedColor.panelLine}; border-top-color: ${themedColor.panelText}; animation: cx-spin 900ms linear infinite;
}
@keyframes cx-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { :is(.home, .wt) .cx-spin { animation: none; border-top-color: ${themedColor.panelMuted}; } }
:is(.home, .wt) .cx-progress { display: flex; flex-direction: column; gap: 6px; width: 200px; }
:is(.home, .wt) .cx-progress__top { display: flex; justify-content: space-between; ${typeCss('small')}; font-weight: 600; color: ${themedColor.panelText}; }
:is(.home, .wt) .cx-bar { height: 4px; border-radius: ${t.radius.sm}px; background: ${themedColor.panelTile}; overflow: hidden; }
:is(.home, .wt) .cx-bar > i { display: block; height: 100%; background: ${themedColor.panelText}; border-radius: ${t.radius.sm}px; }
:is(.home, .wt) .cx-item > .sc { margin: 0 0 12px ${t.space.hero}px; }
:is(.home, .wt) .cx-errline {
  display: flex; align-items: center; gap: 8px; margin: 0 0 12px ${t.space.hero}px; padding: ${t.space.md}px 12px; border-radius: ${t.radius.sm}px;
  background: ${themedColor.errFill}; color: ${themedColor.errInk}; ${typeCss('body')}; font-weight: 600;
}
:is(.home, .wt) .cx-errline .tg-button { margin-left: auto; }

:is(.home, .wt) .cx-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-top: 4px; }
:is(.home, .wt) .cx-foot__more { display: inline-flex; align-items: center; gap: 12px; }
:is(.home, .wt) .cx-foot__note { margin-left: auto; }
:is(.home, .wt) .cx-linkbtn {
  display: inline-flex; align-items: center; gap: 4px; margin-left: auto; padding: 0; border: 0; background: none;
  font: inherit; ${typeCss('body')}; font-weight: 600; color: ${themedColor.link}; cursor: pointer;
}
:is(.home, .wt) .cx-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 20px 0 8px; }
:is(.home, .wt) .cx-empty p { margin: 0; ${typeCss('body')}; color: ${themedColor.panelMuted}; }
:is(.home, .wt) .cx-empty .cx-empty__lead { ${typeCss('bodyLead')}; font-weight: 600; color: ${themedColor.panelText}; }

:is(.home, .wt) .cx-form { display: flex; flex-direction: column; gap: 16px; padding: 16px 0 0; border-top: 1px solid ${themedColor.panelLine}; }
:is(.home, .wt) .cx-form__head { display: flex; flex-direction: column; gap: 2px; }
:is(.home, .wt) .cx-form__title { margin: 0; ${typeCss('bodyLead')}; font-weight: 600; color: ${themedColor.panelText}; }
:is(.home, .wt) .cx-form__lead { margin: 0; ${typeCss('body')}; color: ${themedColor.panelMuted}; }
:is(.home, .wt) .cx-form__hint { margin: 0; ${typeCss('small')}; color: ${themedColor.panelMuted}; }
:is(.home, .wt) .cx-seg {
  display: inline-flex; align-self: flex-start; gap: 3px; padding: 3px; border-radius: ${t.radius.card}px; background: ${themedColor.panelTile};
}
:is(.home, .wt) .cx-seg button {
  height: 30px; padding: 0 ${t.space.xl}px; border: 0; border-radius: ${t.radius.sm}px; background: transparent; cursor: pointer;
  font: inherit; ${typeCss('body')}; font-weight: 600; color: ${themedColor.panelMuted};
}
:is(.home, .wt) .cx-seg button[aria-checked='true'] { background: ${themedColor.card}; color: ${themedColor.panelText}; box-shadow: 0 1px 2px rgba(18, 22, 43, .12); }
:is(.home, .wt) .cx-seg button:focus-visible { outline: 2px solid var(--tg-focus); outline-offset: 2px; }
:is(.home, .wt) .cx-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
:is(.home, .wt) .cx-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
:is(.home, .wt) .cx-field__lbl { ${typeCss('small')}; font-weight: 600; color: ${themedColor.panelText}; }
:is(.home, .wt) .cx-field__hint { ${typeCss('small')}; color: ${themedColor.panelMuted}; }
:is(.home, .wt) .cx-input {
  height: 36px; width: 100%; box-sizing: border-box; padding: 0 12px; border: 1px solid ${themedColor.keycapLine}; border-radius: ${t.radius.sm}px;
  background: ${themedColor.card}; font: inherit; ${typeCss('bodyLead')}; color: ${themedColor.panelText};
}
:is(.home, .wt) .cx-input::placeholder { color: ${themedColor.panelMuted}; }
:is(.home, .wt) .cx-input:focus-visible { outline: 2px solid var(--tg-focus); outline-offset: 2px; }
:is(.home, .wt) .cx-input--code, :is(.home, .wt) .cx-input--area, :is(.home, .wt) .cx-code {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; ${typeCss('body')};
}
:is(.home, .wt) .cx-input--area { height: auto; min-height: 72px; padding: 8px 12px; resize: vertical; white-space: pre; }
:is(.home, .wt) .cx-code { ${typeCss('small')}; background: ${themedColor.panelTile}; padding: ${t.space.xxs}px ${t.space.sm}px; border-radius: ${t.radius.sm}px; color: ${themedColor.panelText}; }
:is(.home, .wt) .cx-form__actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
:is(.home, .wt) .dv-group { display: flex; align-items: baseline; gap: ${t.space.md}px; margin-bottom: ${t.space.sm}px; }
:is(.home, .wt) .dv-group .tg-card__label { margin: 0; }
:is(.home, .wt) .dv-tile { position: relative; }
:is(.home, .wt) .dv-tile__brain { position: absolute; right: -3px; top: -3px; width: 12px; height: 12px; border-radius: 50%; background: ${t.color.gold}; border: 2px solid ${themedColor.panel}; }
:is(.home, .wt) .cx-runs { position: relative; }
:is(.home, .wt) .cx-runs__btn {
  display: inline-flex; align-items: center; gap: ${t.space.sm}px; height: 32px; padding: 0 ${t.space.md}px; border-radius: ${t.radius.sm}px;
  border: 1px solid ${themedColor.keycapLine}; background: ${themedColor.card}; color: ${themedColor.panelText};
  font: inherit; ${typeCss('body')}; font-weight: 600; cursor: pointer; white-space: nowrap;
}
:is(.home, .wt) .cx-runs__btn:disabled { background: transparent; color: ${themedColor.panelMuted}; cursor: default; }
:is(.home, .wt) .cx-runs__label { color: ${themedColor.panelMuted}; font-weight: 400; }
:is(.home, .wt) .cx-runs__menu {
  position: absolute; z-index: 5; right: 0; top: calc(100% + ${t.space.xs}px); width: 300px; padding: ${t.space.sm}px;
  border-radius: ${t.radius.card}px; border: 1px solid ${themedColor.panelLine}; background: ${themedColor.card};
  box-shadow: 0 8px 24px rgba(18, 22, 43, .16); display: flex; flex-direction: column; gap: ${t.space.xxs}px;
}
:is(.home, .wt) .cx-runs__item {
  display: flex; align-items: flex-start; gap: ${t.space.md}px; padding: ${t.space.md}px; border: 0; border-radius: ${t.radius.sm}px;
  background: none; font: inherit; ${typeCss('body')}; color: ${themedColor.panelText}; text-align: left; cursor: pointer;
}
:is(.home, .wt) .cx-runs__item:hover { background: ${themedColor.panelTile}; }
:is(.home, .wt) .cx-runs__item strong { display: block; font-weight: 600; }
:is(.home, .wt) .cx-runs__check { width: 16px; flex: none; padding-top: ${t.space.xxs}px; }
:is(.home, .wt) .cx-runs__first { display: flex; align-items: center; gap: ${t.space.md}px; padding: ${t.space.xs}px ${t.space.md}px ${t.space.md}px ${t.space.xxxl + t.space.xs}px; }
:is(.home, .wt) .cx-runs__seg {
  height: 28px; padding: 0 ${t.space.md}px; border-radius: ${t.radius.sm}px; border: 1px solid ${themedColor.panelLine};
  background: none; font: inherit; ${typeCss('small')}; font-weight: 600; color: ${themedColor.panelMuted}; cursor: pointer;
}
:is(.home, .wt) .cx-runs__seg[aria-pressed='true'] { background: ${themedColor.panelTile}; color: ${themedColor.panelText}; }
:is(.home, .wt) .cx-runs__btn:focus-visible, :is(.home, .wt) .cx-runs__item:focus-visible, :is(.home, .wt) .cx-runs__seg:focus-visible { outline: 2px solid var(--tg-focus); outline-offset: 2px; }
:is(.home, .wt) .dv-confirm {
  display: flex; flex-wrap: wrap; align-items: center; gap: ${t.space.md}px ${t.space.lg}px; padding: ${t.space.lg}px; margin: 0 0 ${t.space.md}px;
  border-radius: ${t.radius.card}px; background: ${themedColor.errFill}; color: ${themedColor.errInk}; ${typeCss('small')};
}
:is(.home, .wt) .dv-confirm > span { flex: 1; min-width: 200px; }
:is(.home, .wt) .dv-confirm .tg-button--quiet { border: 1px solid currentColor; color: inherit; }
:is(.home, .wt) .dv-confirm .tg-button--danger { background: ${themedColor.errInk}; color: ${themedColor.errFill}; }
:is(.home, .wt) .dv-joined { display: flex; align-items: center; gap: ${t.space.md}px; margin: 0 0 ${t.space.lg}px; padding: ${t.space.md}px ${t.space.lg}px; border-radius: ${t.radius.card}px; background: ${themedColor.okFill}; color: ${themedColor.okInk}; }
:is(.home, .wt) .dv-empty__actions { display: flex; flex-wrap: wrap; gap: ${t.space.md}px; }
:is(.home, .wt) .ts-head { display: flex; align-items: center; gap: ${t.space.md}px; }
:is(.home, .wt) .ts-head .tg-card__label { margin: 0; margin-right: auto; }
:is(.home, .wt) .ts-steps { list-style: none; margin: ${t.space.lg}px 0 0; padding: 0; display: flex; flex-direction: column; gap: ${t.space.lg}px; }
:is(.home, .wt) .ts-step { display: flex; gap: ${t.space.lg}px; align-items: flex-start; }
:is(.home, .wt) .ts-step p { margin: ${t.space.xxs}px 0 ${t.space.md}px; }
:is(.home, .wt) .ts-mark { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 1px solid ${themedColor.panelLine}; display: inline-flex; align-items: center; justify-content: center; }
:is(.home, .wt) .ts-step a.tg-button { text-decoration: none; }
:is(.home, .wt) .ts-step--now .ts-mark { background: ${t.color.gold}; border-color: transparent; }
:is(.home, .wt) .ts-step--done .ts-mark { background: ${themedColor.okFill}; color: ${themedColor.okInk}; border-color: transparent; }
:is(.home, .wt) .ts-address { display: flex; align-items: center; gap: ${t.space.md}px; margin: ${t.space.lg}px 0 0; }
`;
