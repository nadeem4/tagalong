/**
 * The walkthrough's sheet: Scout's navy side and the off-white page, built from the design
 * tokens, scoped under `.wt`. Contains WALKTHROUGH_CSS. The look follows the approved mockup;
 * the words are in the step files.
 */
import { themeTokens as t, typeCss } from '../theme/tokens';

export const WALKTHROUGH_CSS = `
.wt {
  display: grid; grid-template-columns: ${t.size.navWidth}px minmax(0, 1fr); height: 100vh; margin: 0;
  background: ${t.color.panel}; color: ${t.color.panelText};
  font-family: ${t.font.ui}; ${typeCss('body')};
}
.wt * { box-sizing: border-box; }
.wt button, .wt input, .wt select { font-family: inherit; }
.wt :focus-visible { outline: ${t.size.focusRing}px solid var(--tg-focus); outline-offset: ${t.size.focusOffset}px; }
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
.wt-name { margin: 10px 0 0; font-family: ${t.font.wordmark}; ${typeCss('title')}; }
.wt-role { margin: 2px 0 0; ${typeCss('small')}; color: #7CB8F2; }
.wt-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; flex: 1; }
.wt-steps button {
  width: 100%; height: 34px; display: flex; align-items: center; gap: ${t.space.lg}px; padding: 0 ${t.space.lg}px;
  border: 0; border-radius: ${t.radius.field}px; background: transparent; color: ${t.color.textMuted};
  ${typeCss('body')}; text-align: left; cursor: pointer;
}
.wt-steps button:hover:not(:disabled) { color: ${t.color.text}; }
.wt-steps button:disabled { color: #6B7290; cursor: default; }
.wt-steps button[aria-current='step'] { background: ${t.color.rowActive}; color: ${t.color.text}; font-weight: ${t.fontWeight.semibold}; }
.wt-mark {
  flex: none; width: 18px; height: 18px; border-radius: 9px; display: grid; place-items: center;
  border: 1.5px solid currentColor; ${typeCss('caption')}; opacity: .7;
}
.wt-steps [data-done] .wt-mark { border: 0; background: ${t.color.fieldLine}; opacity: 1; color: ${t.color.text}; }
.wt-steps [aria-current='step'] .wt-mark { border: 0; opacity: 1; }
.wt-steps [aria-current='step'] .wt-mark::after { content: ''; width: 8px; height: 8px; border-radius: 4px; background: ${t.color.gold}; }
.wt-req { margin-left: auto; ${typeCss('caption')}; color: ${t.color.textMuted}; }
.wt-foot { margin: 0; padding: ${t.space.lg}px ${t.space.lg}px 0; ${typeCss('small')}; color: ${t.color.textMuted}; border-top: 1px solid ${t.color.line}; }

/* The page. The top 40px is the drag strip beside the window's own buttons. */
.wt-page { display: grid; grid-template-rows: 1fr auto; min-height: 0; padding-top: 40px; position: relative; -webkit-app-region: no-drag; }
.wt-page::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 40px; -webkit-app-region: drag; }
.wt-body { overflow-y: auto; scrollbar-width: thin; scrollbar-color: ${t.color.scrollbarThumb} transparent; padding: ${t.space.xs}px 48px 28px; min-height: 0; animation: wt-enter 320ms cubic-bezier(.16, 1, .3, 1) both; }
/* A small or highly scaled screen: tighter gutters so the pinned footer wraps instead of overflowing. */
@media (max-width: 800px) { .wt-body { padding-left: 24px; padding-right: 24px; } .wt-footer { padding: 12px 24px; } }
.wt-body::-webkit-scrollbar { width: 10px; }
.wt-body::-webkit-scrollbar-thumb { background: ${t.color.scrollbarThumb}; border-radius: 5px; border: 2px solid ${t.color.panel}; }
@keyframes wt-enter { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { .wt-body { animation: none; } }
.wt h1 { margin: 0; ${typeCss('display')}; letter-spacing: -0.015em; max-width: 30ch; text-wrap: balance; }
.wt-lead { margin: 10px 0 0; ${typeCss('bodyLead')}; color: ${t.color.panelMuted}; max-width: 60ch; }
.wt-cols { display: grid; grid-template-columns: minmax(0, 1fr) 272px; gap: 32px; margin-top: 28px; align-items: start; }
.wt-facts { list-style: none; margin: 0; padding: 0; }
.wt-facts li { padding: 14px 0; border-top: 1px solid ${t.color.panelLine}; }
.wt-facts li:first-child { border-top: 0; padding-top: 0; }
.wt-facts h3, .wt-card h3 { margin: 0; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; }
.wt-facts p, .wt-help { margin: 4px 0 0; ${typeCss('body')}; color: ${t.color.panelMuted}; max-width: 62ch; }
.wt-note { margin: 28px 0 0; padding-top: 16px; border-top: 1px solid ${t.color.panelLine}; ${typeCss('body')}; color: ${t.color.panelMuted}; max-width: 64ch; }
.wt-label { display: block; margin: 0 0 8px; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; }
.wt-card { background: #fff; border: 1px solid ${t.color.panelLine}; border-radius: 12px; padding: 16px 20px; }
.wt-link { background: none; border: 0; padding: 0; color: ${t.color.panelText}; font-size: inherit; text-decoration: underline; cursor: pointer; }

.wt-code { display: inline-block; max-width: 100%; margin-top: 6px; padding: 4px 8px; border-radius: 6px; background: ${t.color.panelTile}; font-family: ${t.font.mono}; ${typeCss('small')}; overflow-wrap: anywhere; user-select: all; }
.wt-note h3 { margin: 0; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; }
.wt-numbered { counter-reset: wt-n; }
.wt-numbered li { counter-increment: wt-n; }
.wt-numbered h3::before { content: counter(wt-n) '. '; }

/* Controls */
.wt label { ${typeCss('small')}; color: ${t.color.panelMuted}; }
.wt :where(input, select) {
  height: ${t.size.fieldHeight}px; padding: 0 12px; border: 1px solid ${t.color.panelLine}; border-radius: ${t.radius.field}px;
  background: ${t.color.panelTile}; color: ${t.color.panelText}; ${typeCss('bodyLead')}; min-width: 0;
}
.wt-row { display: flex; align-items: center; gap: ${t.space.lg}px; flex-wrap: wrap; }

/* Steps 1 to 4 */
.wt-body > section > .wt-label:first-child { margin-bottom: 10px; color: ${t.color.panelMuted}; ${typeCss('caption')}; }
.wt-day { margin-top: 28px; background: #fff; border: 1px solid ${t.color.panelLine}; border-radius: 16px; overflow: hidden; }
.wt-day > .wt-label { margin: 0; padding: 16px 24px 12px; color: ${t.color.panelMuted}; ${typeCss('caption')}; }
.wt-day ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid ${t.color.panelLine}; }
.wt-day li { position: relative; padding: 24px 24px 28px; border-left: 1px solid ${t.color.panelLine}; }
.wt-day li:first-child { border-left: 0; }
.wt-day li::before { content: ''; position: absolute; top: -6px; left: 24px; width: 11px; height: 11px; border-radius: 50%; background: ${t.color.gold}; border: 1.5px solid ${t.color.goldInk}; }
.wt-where { display: block; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelMuted}; }
.wt q { display: block; quotes: '“' '”'; margin-top: 10px; ${typeCss('title')}; }
.wt-note--plain { border-top: 0; padding-top: 0; margin-top: 20px; }

.wt-flow { list-style: none; margin: 28px 0 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 28px; }
.wt-flow > li { position: relative; min-width: 0; }
.wt-flow > li:not(:last-child)::after { content: '→' / ''; position: absolute; right: -24px; top: 50%; transform: translateY(-50%); color: ${t.color.panelMuted}; ${typeCss('title')}; }
.wt-node { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; background: #fff; border: 1px solid ${t.color.panelLine}; border-radius: 12px; ${typeCss('body')}; }
.wt-node .wt-label { margin: 0; ${typeCss('caption')}; color: ${t.color.panelMuted}; }
.wt-node .wt-help { margin: 0; }
.wt-node--back { background: ${t.color.warnFill}; border-color: ${t.color.gold}; }
.wt-hub { display: grid; place-items: center; width: 96px; height: 96px; border-radius: 12px; background: ${t.color.page}; color: ${t.color.text}; ${typeCss('title')}; }
.wt-routes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; width: 210px; }
.wt-sub { margin: 28px 0 0; padding-top: 16px; border-top: 1px solid ${t.color.panelLine}; ${typeCss('body')}; font-weight: ${t.fontWeight.semibold}; }
.wt-chips { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 8px 0 0; padding: 0; }
.wt-chips--apps { margin-top: 10px; }
.wt-chip-app { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border: 1px solid ${t.color.panelLine}; border-radius: 14px; background: #fff; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; }
.wt-chip-app--any { border-style: dashed; background: transparent; color: ${t.color.panelMuted}; }

.wt-moments { list-style: none; margin: 24px 0 0; padding: 0 20px; background: #fff; border: 1px solid ${t.color.panelLine}; border-radius: 16px; }
.wt-moments li { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 16px; align-items: center; padding: 14px 0; border-top: 1px solid ${t.color.panelLine}; }
.wt-moments li:first-child { border-top: 0; }
.wt-moments q { margin-top: 0; ${typeCss('title')}; }
.wt-moments .wt-help::before { content: '→  ' / ''; }

.wt-keyrow { margin-bottom: 16px; }
.wt-keyrow > .wt-label { color: ${t.color.panelMuted}; ${typeCss('caption')}; }
.wt-keybox { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; background: #fff; border: 1px solid ${t.color.panelLine}; border-radius: 12px; }
.wt-keyrow input { width: 100%; }
.wt-bubble { display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: 14px; background: ${t.color.page}; color: ${t.color.text}; border: 1px solid ${t.color.fieldLine}; ${typeCss('body')}; }
.wt-bubble__chip { align-self: flex-start; padding: 4px 10px; border-radius: 999px; background: ${t.color.rowActive}; ${typeCss('small')}; }
.wt-bubble__field { padding: 10px 12px; border: 1px solid ${t.color.gold}; border-radius: ${t.radius.field}px; background: ${t.color.field}; }
.wt-bubble__row { display: flex; align-items: center; gap: 10px; }
.wt-bubble__quiet { padding: 6px 10px; border: 1px solid ${t.color.fieldLine}; border-radius: ${t.radius.field}px; ${typeCss('small')}; }
.wt-bubble__hint { margin-left: auto; ${typeCss('small')}; color: ${t.color.textMuted}; }
.wt-bubble__ask { padding: 6px 14px; border-radius: ${t.radius.field}px; background: ${t.color.gold}; color: ${t.color.goldInk}; font-weight: ${t.fontWeight.semibold}; }
.wt-never { margin-top: 24px; }
.wt-never > .wt-label { color: ${t.color.panelMuted}; ${typeCss('caption')}; }

/* Steps 5 to 9 */
.wt-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 32px; margin-top: 24px; align-items: start; }
.wt-form > .wt-help:last-child { grid-column: 1 / -1; }
.wt-switchrow { justify-content: space-between; flex-wrap: nowrap; padding: 12px 16px; background: #fff; border: 1px solid ${t.color.panelLine}; border-radius: 12px; }
.wt-pair { display: flex; align-items: flex-end; gap: 8px; }
.wt-pair > :first-child { flex: 1; min-width: 0; }
.wt-jobs { list-style: none; margin: 24px 0 0; padding: 0; background: #fff; border: 1px solid ${t.color.panelLine}; border-radius: 12px; }
.wt-job { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 20px; border-top: 1px solid ${t.color.panelLine}; }
.wt-job:first-child { border-top: 0; }
.wt-job h3 { margin: 0; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; }
.wt-job__text { min-width: 0; }
.wt-job__act { flex: none; max-width: 200px; text-align: right; }
.wt-job__act .wt-help { margin: 0; }
.wt-expert { margin-top: 8px; }
.wt-sub-label { margin-top: 24px; color: ${t.color.panelMuted}; ${typeCss('caption')}; }
.wt-steplist { margin: 0; padding: 0; list-style: none; counter-reset: wt-s; display: flex; flex-direction: column; gap: 10px; }
.wt-steplist li { counter-increment: wt-s; display: flex; align-items: center; gap: 12px; ${typeCss('bodyLead')}; }
.wt-steplist li::before { content: counter(wt-s); flex: none; width: 22px; height: 22px; border-radius: 11px; display: grid; place-items: center; background: ${t.color.sidebar}; color: ${t.color.text}; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; }
/* The preview cards are illustrations of the navy bubble, not live controls. */
.wt-handoff { display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: 14px; background: ${t.color.sidebar}; color: ${t.color.text}; }
.wt-handoff h3 { margin: 0; ${typeCss('title')}; }
.wt-handoff p { margin: 0; ${typeCss('small')}; color: ${t.color.textMuted}; }
.wt-handoff__row { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 8px; padding-top: 10px; border-top: 1px solid ${t.color.line}; }
.wt-handoff__row code { font-family: ${t.font.mono}; }
.wt-handoff__actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 10px; border-top: 1px solid ${t.color.line}; }
.wt-handoff__cancel, .wt-handoff__send { padding: 5px 12px; border-radius: ${t.radius.field}px; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; }
.wt-handoff__cancel { border: 1px solid ${t.color.line}; color: ${t.color.text}; }
.wt-handoff__send { background: ${t.color.gold}; color: ${t.color.goldInk}; }
.wt-notes { margin-top: 24px; max-width: 640px; }
.wt-checks { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 10px; ${typeCss('bodyLead')}; }
.wt-checks li { display: flex; align-items: center; gap: 10px; }
.wt-checks li::before { content: '✓'; flex: none; color: ${t.color.okInk}; font-weight: ${t.fontWeight.semibold}; }
.wt-cols--even { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.wt-keylist { list-style: none; margin: 0; padding: 0 16px; background: #fff; border: 1px solid ${t.color.panelLine}; border-radius: 12px; }
.wt-keylist li { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; border-top: 1px solid ${t.color.panelLine}; }
.wt-keylist li:first-child { border-top: 0; }
.wt-keylist q { margin: 0; ${typeCss('bodyLead')}; }

/* Footer */
.wt-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px ${t.space.lg}px; padding: 16px 48px; min-width: 0; border-top: 1px solid ${t.color.panelLine}; background: ${t.color.panel}; }
.wt-spacer { flex: 1; }
.wt-primary, .wt-quiet, .wt-text {
  height: ${t.size.fieldHeight}px; padding: 0 16px; border-radius: ${t.radius.field}px; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold};
  cursor: pointer; white-space: nowrap;
}
.wt-primary { border: 1px solid ${t.color.gold}; background: ${t.color.gold}; color: ${t.color.goldInk}; }
.wt-primary:disabled { background: ${t.color.panelTile}; border-color: ${t.color.panelTile}; color: #8A90A6; cursor: not-allowed; }
.wt-quiet { border: 1px solid ${t.color.panelMuted}; background: transparent; color: ${t.color.panelText}; }
.wt-quiet:disabled { opacity: .45; cursor: not-allowed; }
.wt-back::before { content: '←' / ''; margin-right: 8px; }
.wt-next::after { content: '→' / ''; margin-left: 8px; }
.wt-primary:hover:not(:disabled) { filter: brightness(.96); }
.wt-text { border: 0; background: none; color: ${t.color.panelMuted}; padding: 0 4px; }
.wt-text:hover:not(:disabled) { color: ${t.color.panelText}; }
.wt-error { margin: 0; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.errInk}; }
`;
