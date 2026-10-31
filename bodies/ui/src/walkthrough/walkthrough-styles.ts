/**
 * The walkthrough's sheet: Scout's navy side and the off-white page, built from the design
 * tokens, scoped under `.wt`. Contains WALKTHROUGH_CSS. The look follows the approved mockup;
 * the words are in the step files.
 */
import { themeTokens as t } from '../theme/tokens';

export const WALKTHROUGH_CSS = `
.wt {
  display: grid; grid-template-columns: ${t.size.navWidth}px minmax(0, 1fr); height: 100vh; margin: 0;
  background: ${t.color.panel}; color: ${t.color.panelText};
  font-family: ${t.font.ui}; font-size: ${t.fontSize.body}px;
}
.wt * { box-sizing: border-box; }
.wt button, .wt input, .wt select { font-family: inherit; }
.wt :focus-visible { outline: ${t.size.focusRing}px solid ${t.color.gold}; outline-offset: ${t.size.focusOffset}px; }
.wt ::selection { background: ${t.color.gold}; color: ${t.color.goldInk}; }

/* Scout's side. The top strip drags the frameless window. */
.wt-side {
  background: ${t.color.sidebar}; color: ${t.color.text}; display: flex; flex-direction: column;
  padding: 40px ${t.space.lg}px ${t.space.xxl}px; min-height: 0; -webkit-app-region: drag;
}
.wt-side > * { -webkit-app-region: no-drag; }
.wt-scout { padding: ${t.space.xs}px ${t.space.md}px ${t.space.xl}px; }
.wt-tile {
  height: 140px; border-radius: ${t.radius.row + 2}px; background: #222845; overflow: hidden;
  display: grid; place-items: end center;
}
.wt-name { margin: 10px 0 0; font-family: ${t.font.pixel}; font-weight: ${t.fontWeight.bold}; font-size: 18px; letter-spacing: ${t.letterSpacing.title}px; }
.wt-role { margin: 2px 0 0; font-size: ${t.fontSize.small}px; color: #7CB8F2; }
.wt-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; flex: 1; }
.wt-steps button {
  width: 100%; height: 34px; display: flex; align-items: center; gap: ${t.space.lg}px; padding: 0 ${t.space.lg}px;
  border: 0; border-radius: ${t.radius.field}px; background: transparent; color: ${t.color.textMuted};
  font-size: 14px; text-align: left; cursor: pointer;
}
.wt-steps button:hover:not(:disabled) { color: ${t.color.text}; }
.wt-steps button:disabled { color: #6B7290; cursor: default; }
.wt-steps button[aria-current='step'] { background: ${t.color.rowActive}; color: ${t.color.text}; font-weight: ${t.fontWeight.semibold}; }
.wt-mark {
  flex: none; width: 18px; height: 18px; border-radius: 9px; display: grid; place-items: center;
  border: 1.5px solid currentColor; font-size: 10px; opacity: .7;
}
.wt-steps [data-done] .wt-mark { border: 0; background: ${t.color.fieldLine}; opacity: 1; color: ${t.color.text}; }
.wt-steps [aria-current='step'] .wt-mark { border: 0; opacity: 1; }
.wt-steps [aria-current='step'] .wt-mark::after { content: ''; width: 8px; height: 8px; border-radius: 4px; background: ${t.color.gold}; }
.wt-req { margin-left: auto; font-size: ${t.fontSize.min}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.textMuted}; }
.wt-foot { margin: 0; padding: ${t.space.lg}px ${t.space.lg}px 0; font-size: ${t.fontSize.small}px; line-height: 1.5; color: ${t.color.textMuted}; border-top: 1px solid ${t.color.line}; }

/* The page. The top 40px is the drag strip beside the window's own buttons. */
.wt-page { display: grid; grid-template-rows: 1fr auto; min-height: 0; padding-top: 40px; position: relative; -webkit-app-region: no-drag; }
.wt-page::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 40px; -webkit-app-region: drag; }
.wt-body { overflow-y: auto; padding: ${t.space.xs}px 48px 28px; min-height: 0; animation: wt-enter 320ms cubic-bezier(.16, 1, .3, 1) both; }
/* A small or highly scaled screen: tighter gutters so the pinned footer wraps instead of overflowing. */
@media (max-width: 800px) { .wt-body { padding-left: 24px; padding-right: 24px; } .wt-footer { padding: 12px 24px; } }
@keyframes wt-enter { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { .wt-body { animation: none; } }
.wt h1 { margin: 0; font-size: 26px; line-height: 1.2; font-weight: ${t.fontWeight.semibold}; letter-spacing: -.01em; max-width: 30ch; text-wrap: balance; }
.wt-lead { margin: 10px 0 0; font-size: 15px; line-height: 1.55; color: ${t.color.panelMuted}; max-width: 60ch; }
.wt-cols { display: grid; grid-template-columns: minmax(0, 1fr) 272px; gap: 32px; margin-top: 28px; align-items: start; }
.wt-facts { list-style: none; margin: 0; padding: 0; }
.wt-facts li { padding: 14px 0; border-top: 1px solid ${t.color.panelLine}; }
.wt-facts li:first-child { border-top: 0; padding-top: 0; }
.wt-facts h3, .wt-card h3 { margin: 0; font-size: 14px; font-weight: ${t.fontWeight.semibold}; }
.wt-facts p, .wt-help { margin: 4px 0 0; font-size: 13px; line-height: 1.55; color: ${t.color.panelMuted}; max-width: 62ch; }
.wt-note { margin: 28px 0 0; padding-top: 16px; border-top: 1px solid ${t.color.panelLine}; font-size: 13px; line-height: 1.55; color: ${t.color.panelMuted}; max-width: 64ch; }
.wt-label { display: block; margin: 0 0 8px; font-family: ${t.font.pixel}; font-weight: ${t.fontWeight.semibold}; font-size: ${t.fontSize.small}px; letter-spacing: 1px; text-transform: uppercase; }
.wt-card { background: #fff; border: 1px solid ${t.color.panelLine}; border-radius: 12px; padding: 16px 20px; }
.wt-example { background: ${t.color.page}; color: ${t.color.text}; border: 1px solid ${t.color.fieldLine}; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.wt-example p { margin: 0; font-size: ${t.fontSize.small}px; line-height: 1.45; }
.wt-chip { align-self: flex-start; padding: 2px 8px; border-radius: 999px; background: #222845; color: #C9CEE0; font-size: ${t.fontSize.min}px; }
.wt-link { background: none; border: 0; padding: 0; color: ${t.color.panelText}; font-size: inherit; text-decoration: underline; cursor: pointer; }
.wt-fake-button { align-self: flex-end; padding: 4px 10px; border: 1px solid ${t.color.fieldLine}; border-radius: 6px; color: #C9CEE0; font-size: ${t.fontSize.small}px; }
.wt-tag { display: inline-block; padding: 2px 8px; border-radius: 10px; background: ${t.color.panelTile}; color: ${t.color.chipFreeInk}; font-size: ${t.fontSize.min}px; font-weight: ${t.fontWeight.semibold}; }
.wt-tag--now { background: ${t.color.okFill}; color: ${t.color.okInk}; }
.wt-rows { list-style: none; margin: 0; padding: 0; }
.wt-rows li { display: flex; align-items: center; gap: ${t.space.lg}px; padding: 10px 0; border-top: 1px solid ${t.color.panelLine}; }
.wt-rows li:first-child { border-top: 0; }
.wt-rows span:first-child { flex: 1; }
.wt-chips { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 8px 0 0; padding: 0; }
.wt-examples { list-style: none; margin: 20px 0 0; padding: 0; max-width: 640px; }
.wt-examples li { padding: 14px 0; border-top: 1px solid ${t.color.panelLine}; }
.wt-examples li:first-child { border-top: 0; }
.wt-examples q { display: block; font-size: 15px; font-weight: ${t.fontWeight.semibold}; quotes: none; }

.wt-code { display: inline-block; max-width: 100%; margin-top: 6px; padding: 4px 8px; border-radius: 6px; background: ${t.color.panelTile}; font-family: ui-monospace, Consolas, monospace; font-size: ${t.fontSize.small}px; overflow-wrap: anywhere; user-select: all; }
.wt-note h3 { margin: 0; font-size: 14px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; }
.wt-numbered { counter-reset: wt-n; }
.wt-numbered li { counter-increment: wt-n; }
.wt-numbered h3::before { content: counter(wt-n) '. '; }
.wt input[type='number'] { width: 96px; }

/* Controls */
.wt label { font-size: ${t.fontSize.small}px; color: ${t.color.panelMuted}; }
.wt input, .wt select {
  height: ${t.size.fieldHeight}px; padding: 0 12px; border: 1px solid ${t.color.panelLine}; border-radius: ${t.radius.field}px;
  background: ${t.color.panelTile}; color: ${t.color.panelText}; font-size: ${t.fontSize.field}px; min-width: 0;
}
.wt input[type='range'] { padding: 0; border: 0; background: transparent; width: 100%; accent-color: ${t.color.gold}; }
.wt-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 32px; margin-top: 20px; max-width: 640px; }
.wt-grid > div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.wt-row { display: flex; align-items: center; gap: ${t.space.lg}px; flex-wrap: wrap; }
.wt-kbd { display: inline-block; padding: 1px 7px; border: 1px solid ${t.color.panelLine}; border-bottom-width: 2px; border-radius: 6px; background: #fff; font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold}; line-height: 20px; }
.wt-switch { min-width: 64px; height: 32px; padding: 0 12px; border-radius: ${t.radius.field}px; border: 1px solid ${t.color.panelMuted}; background: transparent; color: ${t.color.panelMuted}; font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold}; cursor: pointer; }
.wt-switch[aria-checked='true'] { background: ${t.color.gold}; border-color: ${t.color.gold}; color: ${t.color.goldInk}; }
.wt-setting { display: flex; align-items: flex-start; gap: 20px; margin-top: 20px; max-width: 640px; }
.wt-setting > div { flex: 1; }
.wt-setting h3 { margin: 0; font-size: 15px; font-weight: ${t.fontWeight.semibold}; }

/* Footer */
.wt-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px ${t.space.lg}px; padding: 16px 48px; min-width: 0; border-top: 1px solid ${t.color.panelLine}; background: ${t.color.panel}; }
.wt-spacer { flex: 1; }
.wt-primary, .wt-quiet, .wt-text {
  height: ${t.size.fieldHeight}px; padding: 0 16px; border-radius: ${t.radius.field}px; font-size: 14px; font-weight: ${t.fontWeight.semibold};
  cursor: pointer; white-space: nowrap;
}
.wt-primary { border: 1px solid ${t.color.gold}; background: ${t.color.gold}; color: ${t.color.goldInk}; }
.wt-primary:disabled { background: ${t.color.panelTile}; border-color: ${t.color.panelTile}; color: #8A90A6; cursor: not-allowed; }
.wt-quiet { border: 1px solid ${t.color.panelMuted}; background: transparent; color: ${t.color.panelText}; }
.wt-quiet:disabled { opacity: .45; cursor: not-allowed; }
.wt-text { border: 0; background: none; color: ${t.color.panelMuted}; padding: 0 4px; }
.wt-text:hover:not(:disabled) { color: ${t.color.panelText}; }
.wt-error { margin: 0; font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.errInk}; }
`;
