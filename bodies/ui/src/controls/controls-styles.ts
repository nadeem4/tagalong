/**
 * The shared controls' sheet (toggle, select, keycap, slider, money field, button). Hosts
 * inject CONTROLS_CSS next to their own sheet. A control learns its surface from CSS
 * variables, not props: `:root` is the light page, `.on-navy` the navy chrome, so the focus
 * ring is navy on light and gold on navy without any wiring.
 */
import { themeTokens as t, themedColor, typeCss } from '../theme/tokens';

export const CONTROLS_CSS = `
:root, .home, .wt {
  --tg-focus: ${themedColor.focusRing};
  --tg-ctl-bg: ${themedColor.controlFill};
  --tg-ctl-line: ${themedColor.keycapLine};
  --tg-ctl-ink: ${themedColor.panelText};
  --tg-ctl-muted: ${themedColor.panelMuted};
}
.on-navy {
  --tg-focus: ${t.color.focusOnNavy};
  --tg-ctl-bg: ${t.color.field};
  --tg-ctl-line: ${t.color.fieldLine};
  --tg-ctl-ink: ${t.color.text};
  --tg-ctl-muted: ${t.color.textMuted};
}
.tg-toggle:focus-visible, .tg-three__option:focus-visible, .tg-select select:focus-visible, .tg-slider input:focus-visible,
.tg-money input:focus-visible, .tg-money button:focus-visible, .tg-button:focus-visible {
  outline: ${t.size.focusRing}px solid var(--tg-focus); outline-offset: ${t.size.focusOffset}px;
}
/* Select and money rules carry an extra class so they beat the Settings panel field rules. */
/* Controls size themselves the same on any host page, whatever its reset says. */
.tg-toggle, .tg-select select, .tg-slider input, .tg-money input, .tg-button, .tg-keyfield #tg-api-key,
.tg-keycap { box-sizing: border-box; }
.tg-wordmark { font-family: ${t.font.wordmark}; font-weight: ${t.fontWeight.wordmark}; }
/* The one card box: Home panels, Settings sections and the tour's cards wear it, and a page adds only its layout. */
.tg-card {
  padding: ${t.space.xl}px ${t.space.xxl}px; background: ${themedColor.card};
  border: 1px solid ${themedColor.panelLine}; border-radius: ${t.radius.card}px;
}

.tg-toggle {
  position: relative; flex: none; width: ${t.size.toggleW}px; height: ${t.size.toggleH}px; padding: 0;
  border: 1px solid var(--tg-ctl-line); border-radius: ${t.radius.pill}px;
  background: ${themedColor.scrollbarThumb}; color: ${themedColor.panelText}; cursor: pointer;
  font-family: ${t.font.ui}; ${typeCss('caption')};
  transition: background 120ms;
}
.tg-toggle:hover:not(:disabled) { border-color: var(--tg-ctl-muted); }
.tg-toggle[aria-checked='true'] { background: ${t.color.gold}; border-color: ${t.color.gold}; color: ${t.color.goldInk}; }
.tg-toggle:disabled { opacity: 0.5; cursor: not-allowed; }
.tg-toggle__word { position: absolute; top: 50%; right: 6px; transform: translateY(-50%); }
.tg-toggle[aria-checked='true'] .tg-toggle__word { right: auto; left: 7px; }
.tg-toggle__knob {
  position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
  background: ${themedColor.keycapFill}; box-shadow: 0 1px 2px ${t.color.line}; transition: transform 120ms;
}
.tg-toggle[aria-checked='true'] .tg-toggle__knob { transform: translateX(${t.size.toggleW - t.size.toggleH}px); }

/* ThreeWay: one pill; the chosen word is filled in gold like an on Toggle. */
.tg-three {
  display: inline-flex; flex: none; padding: 2px; gap: 2px; box-sizing: border-box;
  border: 1px solid var(--tg-ctl-line); border-radius: ${t.radius.pill}px; background: var(--tg-ctl-bg);
}
.tg-three__option {
  min-width: 46px; height: ${t.size.toggleH}px; padding: 0 ${t.space.md}px; border: 0;
  border-radius: ${t.radius.pill}px; background: transparent; color: var(--tg-ctl-ink); cursor: pointer;
  font-family: ${t.font.ui}; ${typeCss('caption')};
  transition: background 120ms;
}
.tg-three__option:hover:not(:disabled):not([aria-checked='true']) { background: var(--tg-ctl-line); }
.tg-three__option[aria-checked='true'] { background: ${t.color.gold}; color: ${t.color.goldInk}; }
.tg-three__option:disabled { opacity: 0.4; cursor: not-allowed; }
.tg-three--cards { display: flex; flex-direction: column; gap: ${t.space.md}px; padding: 0; border: 0; background: none; border-radius: 0; }
.tg-three--cards .tg-three__option {
  display: flex; align-items: center; gap: ${t.space.lg}px; height: auto; min-width: 0;
  padding: 14px 16px; border: 2px solid var(--tg-ctl-line); border-radius: ${t.radius.card}px; background: var(--tg-ctl-bg);
  color: var(--tg-ctl-ink); text-align: left; ${typeCss('small')};
}
.tg-three--cards .tg-three__option strong { ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; }
.tg-three--cards .tg-three__option[aria-checked='true'] { background: var(--tg-ctl-bg); color: var(--tg-ctl-ink); border-color: ${t.color.gold}; }
.tg-three--cards .tg-three__option:hover:not(:disabled):not([aria-checked='true']) { background: var(--tg-ctl-bg); border-color: var(--tg-ctl-muted); }
.tg-three__ring { flex: none; margin-left: auto; width: 20px; height: 20px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--tg-ctl-line); display: grid; place-items: center; }
.tg-three__option[aria-checked='true'] .tg-three__ring { border-color: ${t.color.gold}; }
.tg-three__option[aria-checked='true'] .tg-three__ring::after { content: ''; width: 10px; height: 10px; border-radius: 50%; background: ${t.color.gold}; }
.tg-three__text { display: flex; flex-direction: column; gap: 2px; }
.tg-three__detail { color: var(--tg-ctl-muted); }

.tg-select { display: flex; flex-direction: column; gap: ${t.space.xs}px; min-width: 0; }
.tg-select__label { color: var(--tg-ctl-muted); ${typeCss('small')}; }
.tg-select__wrap { position: relative; display: block; }
.tg-select .tg-select__wrap select {
  appearance: none; width: 100%; height: ${t.size.control}px; padding: 0 ${t.space.page}px 0 ${t.space.lg}px;
  border: 1px solid var(--tg-ctl-line); border-radius: ${t.radius.sm}px;
  background: var(--tg-ctl-bg); color: var(--tg-ctl-ink);
  font-family: ${t.font.ui}; ${typeCss('bodyLead')}; cursor: pointer;
}
.tg-select select:hover:not(:disabled) { border-color: var(--tg-ctl-muted); }
.tg-select select:disabled { opacity: 0.5; cursor: not-allowed; }
.tg-select__chevron {
  position: absolute; top: 50%; right: ${t.space.lg}px; width: 12px; height: 8px;
  transform: translateY(-50%); color: var(--tg-ctl-muted); pointer-events: none;
}

.tg-shortcut { display: inline-flex; align-items: center; gap: ${t.space.xs}px; white-space: nowrap; }
.tg-keycap {
  display: inline-block; min-width: 24px; padding: 2px ${t.space.md}px; text-align: center;
  border: 1px solid ${themedColor.keycapLine}; border-bottom-width: 2px; border-radius: ${t.radius.sm}px;
  background: ${themedColor.keycapFill}; color: ${themedColor.keycapInk};
  font-family: ${t.font.ui}; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold};
}

.tg-slider { display: flex; flex-direction: column; gap: ${t.space.sm}px; }
.tg-slider__head { display: flex; justify-content: space-between; align-items: baseline; gap: ${t.space.lg}px; }
.tg-slider__head label { color: var(--tg-ctl-muted); ${typeCss('small')}; }
.tg-slider__head output { color: var(--tg-ctl-ink); ${typeCss('body')}; font-weight: ${t.fontWeight.semibold}; }
.tg-slider input[type='range'] {
  appearance: none; width: 100%; height: ${t.size.toggleH}px; margin: 0; background: transparent; cursor: pointer;
}
.tg-slider input[type='range']::-webkit-slider-runnable-track {
  height: 6px; border-radius: ${t.radius.sm}px;
  background: linear-gradient(to right, ${t.color.gold} var(--fill), var(--tg-ctl-line) var(--fill));
}
.tg-slider input[type='range']::-webkit-slider-thumb {
  appearance: none; width: 18px; height: 18px; margin-top: -${t.space.sm}px; border-radius: 50%;
  background: ${t.color.gold}; border: 2px solid ${t.color.goldInk};
}
.tg-slider input[type='range']:hover::-webkit-slider-thumb { background: ${themedColor.keycapFill}; }

.tg-money { display: flex; flex-direction: column; gap: ${t.space.xs}px; }
.tg-money > label { color: var(--tg-ctl-muted); ${typeCss('small')}; }
.tg-money__row { display: flex; align-items: center; gap: ${t.space.sm}px; }
.tg-money__prefix { color: var(--tg-ctl-muted); ${typeCss('bodyLead')}; }
.tg-money .tg-money__row input[type='text'] {
  width: 96px; height: ${t.size.control}px; padding: 0 ${t.space.lg}px;
  border: 1px solid var(--tg-ctl-line); border-radius: ${t.radius.sm}px;
  background: var(--tg-ctl-bg); color: var(--tg-ctl-ink);
  font-family: ${t.font.ui}; ${typeCss('bodyLead')};
}
.tg-money .tg-money__row input[type='text'][aria-invalid='true'] { border: 2px solid ${themedColor.errInk}; }
.tg-money .tg-button {
  width: ${t.size.control}px; padding: 0; color: var(--tg-ctl-ink); border-color: var(--tg-ctl-muted);
}
.tg-meter {
  flex: 1; min-width: 120px; height: 10px; border-radius: ${t.radius.sm}px; overflow: hidden;
  border: 1px solid var(--tg-ctl-line); background: var(--tg-ctl-bg);
}
.tg-meter__bar { width: var(--level); height: 100%; background: var(--tg-ctl-ink); transition: width 80ms linear; }
.tg-meter__bar--loud { background: ${t.color.gold}; }
.tg-mictest { display: flex; flex-direction: column; gap: ${t.space.sm}px; }
.tg-mictest__row { display: flex; align-items: center; gap: ${t.space.lg}px; }
.tg-mictest__help { margin: 0; color: var(--tg-ctl-muted); ${typeCss('small')}; }
.tg-mictest__error { margin: 0; color: ${themedColor.errInk}; ${typeCss('small')}; }
.tg-sr-only {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

.tg-button {
  display: inline-flex; align-items: center; justify-content: center; gap: ${t.space.sm}px;
  height: ${t.size.control}px; padding: 0 ${t.space.xl}px; border-radius: ${t.radius.sm}px;
  border: 1px solid transparent; cursor: pointer;
  font-family: ${t.font.ui}; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold};
}
.tg-button:disabled { opacity: 0.5; cursor: not-allowed; }
.tg-button--primary { background: ${t.color.gold}; border-color: ${t.color.gold}; color: ${t.color.goldInk}; }
.tg-button--primary:hover:not(:disabled) { filter: brightness(1.08); }
.tg-button--secondary { background: var(--tg-ctl-bg); border-color: var(--tg-ctl-line); color: var(--tg-ctl-ink); }
.tg-button--secondary:hover:not(:disabled) { border-color: var(--tg-ctl-muted); }
.tg-button--quiet { background: transparent; color: var(--tg-ctl-muted); }
.tg-button--quiet:hover:not(:disabled) { color: var(--tg-ctl-ink); background: var(--tg-ctl-bg); }
.tg-button--danger { background: ${themedColor.errFill}; border-color: ${themedColor.errInk}; color: ${themedColor.errInk}; }
.tg-button--danger:hover:not(:disabled) { background: ${themedColor.errInk}; color: ${themedColor.errFill}; }

.tg-keyfield { display: flex; flex-direction: column; gap: ${t.space.sm}px; }
.tg-keyfield__label { color: var(--tg-ctl-ink); ${typeCss('body')}; font-weight: ${t.fontWeight.semibold}; }
.tg-keyfield__row { display: flex; align-items: center; gap: ${t.space.md}px; }
.tg-keyfield__box { position: relative; flex: 1; min-width: 0; }
/* The id selector outranks Settings' generic input rule whatever the sheet order. */
.tg-keyfield #tg-api-key {
  width: 100%; height: ${t.size.fieldHeight}px; padding: 0 ${t.space.hero}px 0 ${t.space.lg}px;
  border: 1px solid var(--tg-ctl-line); border-radius: ${t.radius.sm}px;
  background: var(--tg-ctl-bg); color: var(--tg-ctl-ink);
  font-family: ${t.font.ui}; ${typeCss('bodyLead')};
}
.tg-keyfield #tg-api-key:focus-visible { outline: ${t.size.focusRing}px solid var(--tg-focus); outline-offset: ${t.size.focusOffset}px; }
.tg-keyfield[data-state='valid'] #tg-api-key { border-color: ${themedColor.okInk}; }
.tg-keyfield #tg-api-key[aria-invalid='true'] { border: 2px solid ${themedColor.errInk}; }
.tg-keyfield__box .tg-keyfield__show {
  position: absolute; top: 50%; right: ${t.space.xs}px; transform: translateY(-50%);
  height: 28px; padding: 0 ${t.space.md}px;
}
.tg-keyfield__row > .tg-button { height: ${t.size.fieldHeight}px; }
.tg-keyfield__status { min-height: 20px; }
.tg-keyfield[data-state='invalid'] .tg-keyfield__status { color: ${themedColor.errInk}; font-weight: ${t.fontWeight.semibold}; }
.tg-keyfield[data-state='valid'] .tg-keyfield__status { color: ${themedColor.okInk}; }
/* Daily limit: what it is on the left, the amount and Set in one row on the right, today's spend
   under them. The steppers sit inside the amount's border. */
.tg-limitfield {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: ${t.space.lg}px 32px; align-items: start;
  padding-top: ${t.space.xl}px; border-top: 1px solid ${themedColor.panelLine};
}
.tg-limitfield__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; max-width: 46ch; }
.tg-limitfield__title { color: var(--tg-ctl-ink); ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; }
.tg-limitfield__ctl { display: flex; flex-direction: column; gap: ${t.space.md}px; align-items: flex-end; width: 300px; }
.tg-limitfield__row { display: flex; align-items: center; gap: ${t.space.md}px; height: ${t.size.control}px; }
.tg-limitfield .tg-money__row {
  gap: 0; height: ${t.size.control}px; overflow: hidden; box-sizing: border-box;
  border: 1px solid var(--tg-ctl-line); border-radius: ${t.radius.sm}px; background: var(--tg-ctl-bg);
}
.tg-limitfield .tg-money__row:focus-within { outline: ${t.size.focusRing}px solid var(--tg-focus); outline-offset: ${t.size.focusOffset}px; }
.tg-limitfield .tg-money__row:has(input[aria-invalid='true']) { border: 2px solid ${themedColor.errInk}; }
.tg-limitfield .tg-money__prefix { padding: 0 2px 0 ${t.space.lg}px; }
.tg-limitfield .tg-money .tg-money__row input[type='text'] {
  width: 64px; height: 100%; padding: 0 ${t.space.md}px 0 2px; border: 0; border-radius: 0; outline: none;
  font-weight: ${t.fontWeight.semibold}; font-variant-numeric: tabular-nums;
}
.tg-limitfield .tg-money .tg-money__row .tg-button {
  width: 32px; height: 100%; border: 0; border-left: 1px solid ${themedColor.panelLine}; border-radius: 0;
}
.tg-limitfield .tg-error, .tg-limitfield .tg-saved {
  display: flex; align-items: center; gap: ${t.space.sm}px; margin: 0; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold};
}
.tg-limitfield .tg-error { color: ${themedColor.errInk}; }
.tg-limitfield .tg-saved { color: ${themedColor.okInk}; }
.tg-limitfield .tg-icon { width: 14px; height: 14px; flex: none; }
.tg-money .tg-button .tg-icon { width: 14px; height: 14px; }
.tg-spend { width: 100%; display: flex; flex-direction: column; gap: ${t.space.sm}px; }
.tg-spend__top { display: flex; justify-content: space-between; gap: ${t.space.lg}px; ${typeCss('small')}; font-variant-numeric: tabular-nums; }
.tg-spend__top strong { color: var(--tg-ctl-ink); font-weight: ${t.fontWeight.semibold}; }
.tg-spend__top span { color: var(--tg-ctl-muted); }
.tg-spendmeter { height: 6px; border-radius: ${t.radius.sm}px; background: ${themedColor.panelTile}; overflow: hidden; }
.tg-spendmeter > i { display: block; height: 100%; border-radius: ${t.radius.sm}px; background: var(--tg-ctl-ink); }
.tg-spendmeter--full > i { background: ${t.color.warnBar}; }
.tg-spend .tg-spend__full { margin: 0; color: ${themedColor.warnInk}; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; }
.tg-spent { margin: 4px 0 0; color: var(--tg-ctl-muted); ${typeCss('small')}; font-variant-numeric: tabular-nums; }
`;
