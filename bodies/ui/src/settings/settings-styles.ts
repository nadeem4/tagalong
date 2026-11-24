/**
 * The Settings window's sheet, built from the design tokens so Settings and Home share one
 * palette. Everything is scoped under `.tg-settings`: navy chrome for the bar and the side
 * menu, off-white panels for the sections you read and edit, gold only for what is
 * selected, focused or primary.
 */
import { themeTokens as t, themedColor, typeCss } from '../theme/tokens';

export const SETTINGS_CSS = `
.tg-settings {
  display: grid; grid-template-columns: ${t.size.navWidth}px 1fr;
  grid-template-rows: ${t.size.headerHeight}px 1fr;
  height: 100vh; margin: 0; background: ${t.color.page}; color: ${t.color.text};
  font-family: ${t.font.ui}; ${typeCss('body')};
}
.tg-settings * { box-sizing: border-box; }
/* Inside Home: no bar and no side menu of its own, just the sections in Home's page. */
.tg-settings--embedded { display: block; height: auto; background: transparent; }
.tg-settings--embedded .tg-main { padding: 0; overflow: visible; }
.tg-settings ::selection { background: ${t.color.gold}; color: ${t.color.goldInk}; }
.tg-settings :focus-visible {
  outline: ${t.size.focusRing}px solid var(--tg-focus); outline-offset: ${t.size.focusOffset}px;
}
.tg-settings ::-webkit-scrollbar { width: 8px; height: 8px; }
.tg-settings ::-webkit-scrollbar-track { background: transparent; }
.tg-settings ::-webkit-scrollbar-thumb { background: ${themedColor.scrollbarThumb}; border-radius: ${t.radius.sm}px; }
.tg-sr {
  position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0);
  white-space: nowrap;
}
.tg-main { overflow-y: auto; padding: ${t.space.xxl}px; display: flex; flex-direction: column; gap: ${t.space.xl}px; }
.tg-panel { color: ${themedColor.panelText}; margin: 0; min-width: 0; }
/* The box is .tg-card's when embedded in Home; the standalone window draws its own. */
.tg-panel:not(.tg-card) {
  background: ${themedColor.panel}; border-radius: ${t.radius.card}px; padding: ${t.space.xxl}px; border: 0;
}
.tg-panel__heading {
  ${typeCss('title')};
  margin: 0 0 ${t.space.lg}px; padding: 0;
}
.tg-panel h3 {
  ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold};
  margin: ${t.space.xxl}px 0 ${t.space.md}px;
}
.tg-panel h3:first-child { margin-top: 0; }
.tg-panel label { display: block; margin-bottom: ${t.space.lg}px; }
.tg-panel label > span {
  display: block; margin-bottom: ${t.space.xs}px; color: ${themedColor.panelMuted}; ${typeCss('small')};
}
.tg-panel input:not([type]), .tg-panel input[type='text'], .tg-panel input[type='password'],
.tg-panel input[type='number'], .tg-panel select, .tg-panel textarea {
  width: 100%; min-height: ${t.size.fieldHeight}px; padding: 0 ${t.space.lg}px;
  border: 1px solid ${themedColor.panelLine}; border-radius: ${t.radius.sm}px;
  background: ${themedColor.panelTile}; color: ${themedColor.panelText};
  font-family: ${t.font.ui}; ${typeCss('bodyLead')};
}
.tg-panel textarea { padding: ${t.space.md}px ${t.space.lg}px; resize: vertical; }
.tg-panel input[type='color'] { width: 64px; height: ${t.size.fieldHeight}px; padding: ${t.space.xxs}px; }
.tg-panel ::placeholder { color: ${themedColor.panelMuted}; opacity: 1; }
.tg-note { color: ${themedColor.panelMuted}; ${typeCss('small')}; margin: 0 0 ${t.space.lg}px; }
.tg-error { display: flex; gap: ${t.space.sm}px; align-items: center; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; }
.tg-btn-quiet {
  height: ${t.size.fieldHeight}px; padding: 0 ${t.space.xl}px; border-radius: ${t.radius.sm}px;
  font-family: ${t.font.ui}; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; cursor: pointer;
}
.tg-btn-quiet { border: 1px solid ${t.color.fieldLine}; background: transparent; color: ${t.color.textMuted}; }
.tg-btn-quiet:hover { color: ${t.color.text}; }
.tg-panel .tg-btn-quiet { border-color: ${themedColor.panelMuted}; color: ${themedColor.panelText}; }
.tg-chip {
  display: inline-flex; align-items: center; gap: ${t.space.xs}px; padding: ${t.space.xxs}px ${t.space.md}px;
  border-radius: ${t.radius.pill}px; background: ${themedColor.chipFree}; color: ${themedColor.chipFreeInk};
  ${typeCss('caption')};
}
.tg-chip--ok { background: ${themedColor.okFill}; color: ${themedColor.okInk}; }
.tg-chip--warn { background: ${themedColor.warnFill}; color: ${themedColor.warnInk}; }
.tg-chip--err { background: ${themedColor.errFill}; color: ${themedColor.errInk}; }
.tg-chips { display: flex; flex-wrap: wrap; gap: ${t.space.sm}px; list-style: none; margin: ${t.space.md}px 0 0; padding: 0; }
.tg-folders { list-style: none; margin: 0 0 ${t.space.md}px; padding: 0; display: grid; gap: ${t.space.sm}px; }
.tg-folder { display: flex; align-items: center; justify-content: space-between; gap: ${t.space.md}px; }
.tg-folder__path { overflow-wrap: anywhere; ${typeCss('caption')}; }
.tg-choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: ${t.space.sm}px; margin: 0 0 ${t.space.lg}px; padding: 0; border: 0; }
.tg-panel label.tg-choice {
  display: block; margin: 0; padding: ${t.space.md}px ${t.space.lg}px; border: 2px solid ${themedColor.panelLine};
  border-radius: ${t.radius.card}px; cursor: pointer;
}
.tg-choice:hover { background: ${themedColor.panelTile}; }
.tg-choice:has(input:checked) { border-color: ${t.color.gold}; background: ${themedColor.panelTile}; }
.tg-choice:has(input:focus-visible) { outline: ${t.size.focusRing}px solid var(--tg-focus); outline-offset: ${t.size.focusOffset}px; }
.tg-choice input { position: absolute; opacity: 0; width: 1px; height: 1px; }

/* The Settings page: sections, ⓘ notes, status and errors. */
.tg-settings [hidden] { display: none !important; }
.tg-settings .tg-panel { display: flex; flex-direction: column; gap: ${t.space.xl}px; }
.tg-settings .tg-panel label { margin-bottom: 0; }
.tg-settings .tg-panel__heading { margin: 0; }
.tg-settings .tg-chips { margin: 0; }
.tg-settings--embedded .tg-main { gap: ${t.space.xxl}px; }
.tg-intro { display: flex; flex-wrap: wrap; align-items: flex-end; gap: ${t.space.xl}px; }
.tg-intro__text { flex: 1 1 320px; display: flex; flex-direction: column; gap: ${t.space.sm}px; }
.tg-intro__save { display: flex; align-items: center; gap: ${t.space.md}px; margin-left: auto; }
.tg-intro__save p { margin: 0; }
.tg-intro__title { margin: 0; ${typeCss('heading')}; color: ${themedColor.panelText}; }
.tg-titlerow { display: flex; align-items: center; gap: ${t.space.sm}px; }
.tg-panel h3.tg-sub {
  margin: 0; font-family: ${t.font.ui};
  ${typeCss('title')}; color: ${themedColor.panelText};
}
.tg-help { margin: 0; color: ${themedColor.panelMuted}; ${typeCss('body')}; }
.tg-info {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border: 0; border-radius: ${t.radius.card}px;
  background: transparent; color: ${themedColor.panelMuted}; cursor: pointer;
}
.tg-info:hover { background: ${themedColor.panelTile}; color: ${themedColor.panelText}; }
.tg-info[aria-expanded='true'] { background: ${themedColor.panelText}; color: ${themedColor.panel}; }
.tg-tip {
  margin: 0; padding: ${t.space.lg}px ${t.space.xl}px; border-radius: ${t.radius.sm}px;
  background: ${themedColor.panelTile}; color: ${themedColor.panelText}; ${typeCss('body')};
}
.tg-labelrow {
  display: flex; align-items: center; gap: ${t.space.xs}px; min-height: 24px; margin-bottom: ${t.space.xs}px;
  color: ${themedColor.panelMuted}; ${typeCss('small')};
}
.tg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: ${t.space.xl}px; }
.tg-inline { display: flex; flex-wrap: wrap; align-items: flex-end; gap: ${t.space.md}px; }
.tg-inline label { flex: 1 1 320px; }
.tg-actions { display: flex; flex-wrap: wrap; align-items: center; gap: ${t.space.md}px; }
.tg-setting { display: flex; align-items: flex-start; gap: ${t.space.xxl}px; }
.tg-voice-pick { align-items: flex-end; }
.tg-voice-pick .tg-select { flex: 1; }
.tg-shortcut + input { margin-top: ${t.space.sm}px; }
.tg-setting__text { flex: 1; display: flex; flex-direction: column; gap: ${t.space.xs}px; }
.tg-divider { margin: 0; height: 1px; border: 0; background: ${themedColor.panelLine}; }
.tg-panel [aria-invalid='true'] { border: 2px solid ${themedColor.errInk}; }
.tg-panel .tg-error, .tg-settings--embedded .tg-error { color: ${themedColor.errInk}; }
.tg-field-error { margin: ${t.space.xs}px 0 0; white-space: pre-line; }
.tg-settings--embedded .tg-saved { color: ${themedColor.okInk}; font-weight: ${t.fontWeight.semibold}; }
`;
