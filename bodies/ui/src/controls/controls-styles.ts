/**
 * The shared controls' sheet (toggle, select, keycap, slider, money field, button). Hosts
 * inject CONTROLS_CSS next to their own sheet. A control learns its surface from CSS
 * variables, not props: `:root` is the light page, `.on-navy` the navy chrome, so the focus
 * ring is navy on light and gold on navy without any wiring.
 */
import { themeTokens as t } from '../theme/tokens';

export const CONTROLS_CSS = `
:root {
  --tg-focus: ${t.color.focusOnLight};
  --tg-ctl-bg: ${t.color.panelTile};
  --tg-ctl-line: ${t.color.panelLine};
  --tg-ctl-ink: ${t.color.panelText};
  --tg-ctl-muted: ${t.color.panelMuted};
}
.on-navy {
  --tg-focus: ${t.color.focusOnNavy};
  --tg-ctl-bg: ${t.color.field};
  --tg-ctl-line: ${t.color.fieldLine};
  --tg-ctl-ink: ${t.color.text};
  --tg-ctl-muted: ${t.color.textMuted};
}
.tg-toggle:focus-visible, .tg-select select:focus-visible, .tg-slider input:focus-visible,
.tg-money input:focus-visible, .tg-money button:focus-visible, .tg-button:focus-visible {
  outline: ${t.size.focusRing}px solid var(--tg-focus); outline-offset: ${t.size.focusOffset}px;
}
.tg-wordmark { font-family: ${t.font.wordmark}; font-weight: ${t.fontWeight.wordmark}; }

.tg-toggle {
  position: relative; flex: none; width: ${t.size.toggleW}px; height: ${t.size.toggleH}px; padding: 0;
  border: 1px solid var(--tg-ctl-line); border-radius: ${t.size.toggleH}px;
  background: ${t.color.scrollbarThumb}; color: ${t.color.panelText}; cursor: pointer;
  font-family: ${t.font.ui}; font-size: ${t.fontSize.min}px; font-weight: ${t.fontWeight.semibold};
  transition: background 120ms;
}
.tg-toggle:hover:not(:disabled) { border-color: var(--tg-ctl-muted); }
.tg-toggle[aria-checked='true'] { background: ${t.color.gold}; border-color: ${t.color.gold}; color: ${t.color.goldInk}; }
.tg-toggle:disabled { opacity: 0.5; cursor: not-allowed; }
.tg-toggle__word { position: absolute; top: 50%; right: 6px; transform: translateY(-50%); }
.tg-toggle[aria-checked='true'] .tg-toggle__word { right: auto; left: 7px; }
.tg-toggle__knob {
  position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%;
  background: ${t.color.keycapFill}; box-shadow: 0 1px 2px ${t.color.line}; transition: transform 120ms;
}
.tg-toggle[aria-checked='true'] .tg-toggle__knob { transform: translateX(${t.size.toggleW - t.size.toggleH}px); }

.tg-select { display: flex; flex-direction: column; gap: ${t.space.xs}px; min-width: 0; }
.tg-select__label { color: var(--tg-ctl-muted); font-size: ${t.fontSize.small}px; }
.tg-select__wrap { position: relative; display: block; }
.tg-select select {
  appearance: none; width: 100%; height: ${t.size.control}px; padding: 0 34px 0 ${t.space.lg}px;
  border: 1px solid var(--tg-ctl-line); border-radius: ${t.radius.field}px;
  background: var(--tg-ctl-bg); color: var(--tg-ctl-ink);
  font-family: ${t.font.ui}; font-size: ${t.fontSize.field}px; cursor: pointer;
}
.tg-select select:hover:not(:disabled) { border-color: var(--tg-ctl-muted); }
.tg-select select:disabled { opacity: 0.5; cursor: not-allowed; }
.tg-select__chevron {
  position: absolute; top: 50%; right: ${t.space.lg}px; width: 12px; height: 8px;
  transform: translateY(-50%); color: var(--tg-ctl-muted); pointer-events: none;
}

.tg-shortcut { display: inline-flex; align-items: center; gap: ${t.space.xs}px; white-space: nowrap; }
.tg-keycap {
  display: inline-block; min-width: 24px; padding: 2px 7px; text-align: center;
  border: 1px solid ${t.color.keycapLine}; border-bottom-width: 2px; border-radius: 6px;
  background: ${t.color.keycapFill}; color: ${t.color.keycapInk};
  font-family: ${t.font.ui}; font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold};
}

.tg-slider { display: flex; flex-direction: column; gap: ${t.space.sm}px; }
.tg-slider__head { display: flex; justify-content: space-between; align-items: baseline; gap: ${t.space.lg}px; }
.tg-slider__head label { color: var(--tg-ctl-muted); font-size: ${t.fontSize.small}px; }
.tg-slider__head output { color: var(--tg-ctl-ink); font-size: ${t.fontSize.body}px; font-weight: ${t.fontWeight.semibold}; }
.tg-slider input[type='range'] {
  appearance: none; width: 100%; height: ${t.size.toggleH}px; margin: 0; background: transparent; cursor: pointer;
}
.tg-slider input[type='range']::-webkit-slider-runnable-track {
  height: 6px; border-radius: 3px; background: var(--tg-ctl-line);
}
.tg-slider input[type='range']::-webkit-slider-thumb {
  appearance: none; width: 18px; height: 18px; margin-top: -6px; border-radius: 50%;
  background: ${t.color.gold}; border: 2px solid ${t.color.goldInk};
}
.tg-slider input[type='range']:hover::-webkit-slider-thumb { background: ${t.color.keycapFill}; }

.tg-money { display: flex; flex-direction: column; gap: ${t.space.xs}px; }
.tg-money > label { color: var(--tg-ctl-muted); font-size: ${t.fontSize.small}px; }
.tg-money__row { display: flex; align-items: center; gap: ${t.space.sm}px; }
.tg-money__prefix { color: var(--tg-ctl-muted); font-size: ${t.fontSize.field}px; }
.tg-money input {
  width: 96px; height: ${t.size.control}px; padding: 0 ${t.space.lg}px;
  border: 1px solid var(--tg-ctl-line); border-radius: ${t.radius.field}px;
  background: var(--tg-ctl-bg); color: var(--tg-ctl-ink);
  font-family: ${t.font.ui}; font-size: ${t.fontSize.field}px;
}
.tg-money input[aria-invalid='true'] { border: 2px solid ${t.color.errInk}; }
.tg-money .tg-button { width: ${t.size.control}px; padding: 0; }

.tg-button {
  display: inline-flex; align-items: center; justify-content: center; gap: ${t.space.sm}px;
  height: ${t.size.control}px; padding: 0 ${t.space.xl}px; border-radius: ${t.radius.field}px;
  border: 1px solid transparent; cursor: pointer;
  font-family: ${t.font.ui}; font-size: ${t.fontSize.field}px; font-weight: ${t.fontWeight.semibold};
}
.tg-button:disabled { opacity: 0.5; cursor: not-allowed; }
.tg-button--primary { background: ${t.color.gold}; border-color: ${t.color.gold}; color: ${t.color.goldInk}; }
.tg-button--primary:hover:not(:disabled) { filter: brightness(1.08); }
.tg-button--secondary { background: var(--tg-ctl-bg); border-color: var(--tg-ctl-line); color: var(--tg-ctl-ink); }
.tg-button--secondary:hover:not(:disabled) { border-color: var(--tg-ctl-muted); }
.tg-button--quiet { background: transparent; color: var(--tg-ctl-muted); }
.tg-button--quiet:hover:not(:disabled) { color: var(--tg-ctl-ink); background: var(--tg-ctl-bg); }
.tg-button--danger { background: ${t.color.errFill}; border-color: ${t.color.errInk}; color: ${t.color.errInk}; }
.tg-button--danger:hover:not(:disabled) { background: ${t.color.errInk}; color: ${t.color.errFill}; }

.tg-keyfield { display: flex; flex-direction: column; gap: ${t.space.sm}px; }
.tg-keyfield__label { color: var(--tg-ctl-muted); font-size: ${t.fontSize.small}px; }
.tg-keyfield__row { display: flex; align-items: center; gap: ${t.space.md}px; }
.tg-keyfield__box { position: relative; flex: 1; min-width: 0; }
/* The id selector outranks Settings' generic input rule whatever the sheet order. */
.tg-keyfield #tg-api-key {
  width: 100%; height: ${t.size.fieldHeight}px; padding: 0 64px 0 ${t.space.lg}px;
  border: 1px solid var(--tg-ctl-line); border-radius: ${t.radius.field}px;
  background: var(--tg-ctl-bg); color: var(--tg-ctl-ink);
  font-family: ${t.font.ui}; font-size: ${t.fontSize.field}px;
}
.tg-keyfield #tg-api-key:focus-visible { outline: ${t.size.focusRing}px solid var(--tg-focus); outline-offset: ${t.size.focusOffset}px; }
.tg-keyfield[data-state='valid'] /* The id selector outranks Settings' generic input rule whatever the sheet order. */
.tg-keyfield #tg-api-key { border-color: ${t.color.okInk}; }
.tg-keyfield #tg-api-key[aria-invalid='true'] { border: 2px solid ${t.color.errInk}; }
.tg-keyfield__box .tg-keyfield__show {
  position: absolute; top: 50%; right: ${t.space.xs}px; transform: translateY(-50%);
  height: 28px; padding: 0 ${t.space.md}px;
}
.tg-keyfield__row > .tg-button { height: ${t.size.fieldHeight}px; }
.tg-keyfield__status { min-height: 20px; }
.tg-keyfield[data-state='invalid'] .tg-keyfield__status { color: ${t.color.errInk}; font-weight: ${t.fontWeight.semibold}; }
.tg-keyfield[data-state='valid'] .tg-keyfield__status { color: ${t.color.okInk}; }
`;
