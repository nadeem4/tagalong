/**
 * The Settings window's sheet, built from the design tokens so Settings and Home share one
 * palette. Everything is scoped under `.tg-settings`: navy chrome for the bar and the side
 * menu, off-white panels for the sections you read and edit, gold only for what is
 * selected, focused or primary.
 */
import { themeTokens as t } from '../theme/tokens';

export const SETTINGS_CSS = `
.tg-settings {
  display: grid; grid-template-columns: ${t.size.navWidth}px 1fr;
  grid-template-rows: ${t.size.headerHeight}px 1fr;
  height: 100vh; margin: 0; background: ${t.color.page}; color: ${t.color.text};
  font-family: ${t.font.ui}; font-size: ${t.fontSize.body}px;
}
.tg-settings * { box-sizing: border-box; }
/* Inside Home: no bar and no side menu of its own, just the sections in Home's page. */
.tg-settings--embedded { display: block; height: auto; background: transparent; }
.tg-settings--embedded .tg-main { padding: 0; overflow: visible; }
.tg-settings ::selection { background: ${t.color.gold}; color: ${t.color.goldInk}; }
.tg-settings :focus-visible {
  outline: ${t.size.focusRing}px solid ${t.color.gold}; outline-offset: ${t.size.focusOffset}px;
}
.tg-settings ::-webkit-scrollbar { width: 8px; height: 8px; }
.tg-settings ::-webkit-scrollbar-track { background: transparent; }
.tg-settings ::-webkit-scrollbar-thumb { background: ${t.color.scrollbarThumb}; border-radius: 4px; }
.tg-px { font-family: ${t.font.pixel}; letter-spacing: ${t.letterSpacing.pixel}px; }
.tg-sr {
  position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0);
  white-space: nowrap;
}
.tg-main { overflow-y: auto; padding: ${t.space.xxl}px; display: flex; flex-direction: column; gap: ${t.space.xl}px; }
.tg-panel {
  background: ${t.color.panel}; color: ${t.color.panelText}; border-radius: ${t.radius.row}px;
  padding: ${t.space.xxl}px; margin: 0; border: 0; min-width: 0;
}
.tg-panel__heading {
  font-size: ${t.fontSize.panelHeading}px; font-weight: ${t.fontWeight.semibold};
  text-transform: uppercase; margin: 0 0 ${t.space.lg}px; padding: 0;
}
.tg-panel h3 {
  font-family: ${t.font.pixel}; letter-spacing: ${t.letterSpacing.pixel}px;
  font-size: ${t.fontSize.groupHeading}px; font-weight: ${t.fontWeight.bold}; text-transform: uppercase;
  margin: ${t.space.xxl}px 0 ${t.space.md}px;
}
.tg-panel h3:first-child { margin-top: 0; }
.tg-panel label { display: block; margin-bottom: ${t.space.lg}px; }
.tg-panel label > span {
  display: block; margin-bottom: ${t.space.xs}px; color: ${t.color.panelMuted}; font-size: ${t.fontSize.small}px;
}
.tg-panel input:not([type]), .tg-panel input[type='text'], .tg-panel input[type='password'],
.tg-panel input[type='number'], .tg-panel select, .tg-panel textarea {
  width: 100%; min-height: ${t.size.fieldHeight}px; padding: 0 ${t.space.lg}px;
  border: 1px solid ${t.color.panelLine}; border-radius: ${t.radius.field}px;
  background: ${t.color.panelTile}; color: ${t.color.panelText};
  font-family: ${t.font.ui}; font-size: ${t.fontSize.field}px;
}
.tg-panel textarea { padding: ${t.space.md}px ${t.space.lg}px; resize: vertical; }
.tg-panel input[type='color'] { width: 64px; height: ${t.size.fieldHeight}px; padding: ${t.space.xxs}px; }
.tg-panel ::placeholder { color: ${t.color.panelMuted}; opacity: 1; }
.tg-note { color: ${t.color.panelMuted}; font-size: ${t.fontSize.small}px; line-height: 1.5; margin: 0 0 ${t.space.lg}px; }
.tg-error { display: flex; gap: ${t.space.sm}px; align-items: center; font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold}; }
.tg-btn, .tg-btn-quiet {
  height: ${t.size.fieldHeight}px; padding: 0 ${t.space.xl}px; border-radius: ${t.radius.field}px;
  font-family: ${t.font.ui}; font-size: ${t.fontSize.field}px; font-weight: ${t.fontWeight.semibold}; cursor: pointer;
}
.tg-btn { border: 1px solid ${t.color.gold}; background: ${t.color.gold}; color: ${t.color.goldInk}; }
.tg-btn-quiet { border: 1px solid ${t.color.fieldLine}; background: transparent; color: ${t.color.textMuted}; }
.tg-btn-quiet:hover { color: ${t.color.text}; }
.tg-panel .tg-btn-quiet { border-color: ${t.color.panelMuted}; color: ${t.color.panelText}; }
.tg-chip {
  display: inline-flex; align-items: center; gap: ${t.space.xs}px; padding: ${t.space.xxs}px ${t.space.md}px;
  border-radius: ${t.radius.chip}px; background: ${t.color.chipFree}; color: ${t.color.chipFreeInk};
  font-size: ${t.fontSize.min}px; font-weight: ${t.fontWeight.semibold};
}
.tg-chip--ok { background: ${t.color.okFill}; color: ${t.color.okInk}; }
.tg-chip--warn { background: ${t.color.warnFill}; color: ${t.color.warnInk}; }
.tg-chip--err { background: ${t.color.errFill}; color: ${t.color.errInk}; }
.tg-chips { display: flex; flex-wrap: wrap; gap: ${t.space.sm}px; list-style: none; margin: ${t.space.md}px 0 0; padding: 0; }
.tg-choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: ${t.space.sm}px; margin: 0 0 ${t.space.lg}px; padding: 0; border: 0; }
.tg-panel label.tg-choice {
  display: block; margin: 0; padding: ${t.space.md}px ${t.space.lg}px; border: 2px solid ${t.color.panelLine};
  border-radius: ${t.radius.row}px; cursor: pointer;
}
.tg-choice:hover { background: ${t.color.panelTile}; }
.tg-choice:has(input:checked) { border-color: ${t.color.gold}; background: ${t.color.panelTile}; }
.tg-choice:has(input:focus-visible) { outline: ${t.size.focusRing}px solid ${t.color.gold}; outline-offset: ${t.size.focusOffset}px; }
.tg-choice input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.tg-switch {
  display: inline-flex; align-items: center; gap: ${t.space.xs}px; min-width: 64px; height: 32px;
  padding: 0 ${t.space.lg}px; border-radius: ${t.radius.field}px; border: 1px solid ${t.color.panelMuted};
  background: transparent; color: ${t.color.panelMuted}; font-family: ${t.font.ui};
  font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold}; cursor: pointer;
}
.tg-switch[aria-checked='true'] { background: ${t.color.gold}; border-color: ${t.color.gold}; color: ${t.color.goldInk}; }
.tg-footer { display: flex; flex-wrap: wrap; align-items: center; gap: ${t.space.md}px; }
.tg-footer p { flex-basis: 100%; margin: 0; color: ${t.color.textMuted}; font-size: ${t.fontSize.small}px; }

/* The Settings page: sections, ⓘ notes, status and errors. */
.tg-settings [hidden] { display: none !important; }
.tg-settings .tg-panel { display: flex; flex-direction: column; gap: 14px; }
.tg-settings .tg-panel label { margin-bottom: 0; }
.tg-settings .tg-panel__heading { margin: 0; }
.tg-settings .tg-chips { margin: 0; }
.tg-settings--embedded .tg-main { gap: ${t.space.xxl}px; max-width: 820px; }
.tg-settings--embedded .tg-panel {
  background: #fff; border: 1px solid ${t.color.panelLine}; border-radius: 12px; padding: ${t.space.xxxl}px 28px;
}
.tg-settings--embedded .tg-footer p { color: ${t.color.panelMuted}; }
.tg-intro { display: flex; flex-wrap: wrap; align-items: flex-end; gap: ${t.space.xl}px; }
.tg-intro__text { flex: 1 1 320px; display: flex; flex-direction: column; gap: ${t.space.sm}px; }
.tg-intro__title { margin: 0; font-size: ${t.fontSize.title}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; }
.tg-titlerow { display: flex; align-items: center; gap: ${t.space.sm}px; }
.tg-panel h3.tg-sub {
  margin: 0; font-family: ${t.font.ui}; letter-spacing: 0; text-transform: none;
  font-size: 15px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText};
}
.tg-help { margin: 0; color: ${t.color.panelMuted}; font-size: ${t.fontSize.body}px; line-height: 1.55; }
.tg-info {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border: 0; border-radius: 12px;
  background: transparent; color: ${t.color.panelMuted}; cursor: pointer;
}
.tg-info:hover { background: ${t.color.panelTile}; color: ${t.color.panelText}; }
.tg-info[aria-expanded='true'] { background: ${t.color.panelText}; color: ${t.color.panel}; }
.tg-tip {
  margin: 0; padding: ${t.space.lg}px 14px; border-radius: ${t.radius.field}px;
  background: ${t.color.panelTile}; color: ${t.color.panelText}; font-size: ${t.fontSize.body}px; line-height: 1.55;
}
.tg-labelrow {
  display: flex; align-items: center; gap: ${t.space.xs}px; min-height: 24px; margin-bottom: ${t.space.xs}px;
  color: ${t.color.panelMuted}; font-size: ${t.fontSize.small}px;
}
.tg-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: ${t.space.xl}px; }
.tg-inline { display: flex; flex-wrap: wrap; align-items: flex-end; gap: ${t.space.md}px; }
.tg-inline label { flex: 1 1 320px; }
.tg-actions { display: flex; flex-wrap: wrap; align-items: center; gap: ${t.space.md}px; }
.tg-setting { display: flex; align-items: flex-start; gap: ${t.space.xxl}px; }
.tg-panel input[type='range'] { width: 100%; min-height: ${t.size.fieldHeight}px; accent-color: ${t.color.gold}; }
.tg-voice-pick select { flex: 1; width: auto; }
.tg-setting__text { flex: 1; display: flex; flex-direction: column; gap: ${t.space.xs}px; }
.tg-divider { margin: 0; height: 1px; border: 0; background: ${t.color.panelLine}; }
.tg-kbd {
  display: inline-block; margin: 0 2px; padding: 1px 7px; border: 1px solid ${t.color.panelLine};
  border-bottom-width: 2px; border-radius: 6px; background: #fff; color: ${t.color.panelText};
  font-family: ${t.font.ui}; font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold};
}
.tg-panel [aria-invalid='true'] { border: 2px solid ${t.color.errInk}; }
.tg-panel .tg-error, .tg-settings--embedded .tg-error { color: ${t.color.errInk}; }
.tg-field-error { margin: ${t.space.xs}px 0 0; white-space: pre-line; }
.tg-settings--embedded .tg-footer p.tg-saved { color: ${t.color.okInk}; font-weight: ${t.fontWeight.semibold}; }
`;
