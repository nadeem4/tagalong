import { officeTokens as t } from '../office/tokens';

/**
 * The Settings window's sheet, built from the office tokens so Settings and the Crew Office
 * share one palette. Everything is scoped under `.tg-settings`: navy chrome for the bar and
 * the crew list, off-white panels for the sections you read and edit, gold only for what is
 * selected, focused or primary.
 */
export const SETTINGS_CSS = `
.tg-settings {
  display: grid; grid-template-columns: ${t.size.partyWidth}px 1fr;
  grid-template-rows: ${t.size.headerHeight}px 1fr;
  height: 100vh; margin: 0; background: ${t.color.page}; color: ${t.color.text};
  font-family: ${t.font.ui}; font-size: ${t.fontSize.body}px;
}
.tg-settings * { box-sizing: border-box; }
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
.tg-bar {
  grid-column: 1 / -1; display: flex; align-items: center; gap: ${t.space.lg}px;
  padding: 0 ${t.space.xxl}px; border-bottom: 1px solid ${t.color.line}; background: ${t.color.page};
}
.tg-bar__title { font-size: ${t.fontSize.title}px; font-weight: ${t.fontWeight.bold}; margin: 0; }
.tg-bar__meta { margin-left: auto; color: ${t.color.textMuted}; font-size: ${t.fontSize.small}px; }
.tg-nav {
  background: ${t.color.sidebar}; padding: ${t.space.xl}px ${t.space.lg + 2}px; overflow-y: auto;
  display: flex; flex-direction: column; gap: ${t.space.xl}px;
}
.tg-nav__heading {
  font-size: ${t.fontSize.partyHeading}px; font-weight: ${t.fontWeight.semibold};
  color: ${t.color.textMuted}; padding: 0 ${t.space.sm}px; margin: 0;
}
.tg-nav__note {
  color: ${t.color.textMuted}; font-size: ${t.fontSize.small}px; line-height: 1.5;
  padding: 0 ${t.space.sm}px; margin: ${t.space.md}px 0 ${t.space.lg}px;
}
.tg-nav ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${t.space.sm}px; }
.tg-nav a {
  display: block; padding: ${t.space.sm}px ${t.space.md}px; border-radius: ${t.radius.row}px;
  color: ${t.color.textMuted}; text-decoration: none; font-size: ${t.fontSize.body}px;
}
.tg-nav a:hover { background: ${t.color.rowActive}; color: ${t.color.text}; }
.tg-row {
  display: flex; align-items: center; gap: ${t.space.lg}px; width: 100%;
  padding: ${t.space.md}px; border: 2px solid transparent; border-radius: ${t.radius.row}px;
  background: transparent; cursor: pointer; text-align: left;
  font-family: ${t.font.ui}; color: ${t.color.text};
}
.tg-row:hover { background: ${t.color.rowActive}; }
.tg-row[aria-pressed='true'] { background: ${t.color.rowActive}; border-color: ${t.color.gold}; }
.tg-tile {
  flex: none; padding: ${t.space.xs}px; border-radius: ${t.radius.tile}px; background: ${t.color.avatarTile};
}
.tg-name { font-size: ${t.fontSize.petName}px; font-weight: ${t.fontWeight.semibold}; display: block; }
.tg-job {
  font-size: ${t.fontSize.min}px; font-weight: ${t.fontWeight.regular}; text-transform: uppercase;
  display: block; margin-top: ${t.space.xxs}px;
}
.tg-main { overflow-y: auto; padding: ${t.space.xxl}px; display: flex; flex-direction: column; gap: ${t.space.xl}px; }
.tg-panel {
  background: ${t.color.panel}; color: ${t.color.panelText}; border-radius: ${t.radius.row}px;
  padding: ${t.space.xxl}px; margin: 0; border: 0; min-width: 0;
}
.tg-panel__heading {
  font-size: ${t.fontSize.partyHeading}px; font-weight: ${t.fontWeight.semibold};
  text-transform: uppercase; margin: 0 0 ${t.space.lg}px; padding: 0;
}
.tg-panel h3 {
  font-family: ${t.font.pixel}; letter-spacing: ${t.letterSpacing.pixel}px;
  font-size: ${t.fontSize.roomName}px; font-weight: ${t.fontWeight.bold}; text-transform: uppercase;
  margin: ${t.space.xxl}px 0 ${t.space.md}px;
}
.tg-panel h3:first-child { margin-top: 0; }
.tg-panel label { display: block; margin-bottom: ${t.space.lg}px; }
.tg-panel label > span {
  display: block; margin-bottom: ${t.space.xs}px; color: ${t.color.panelMuted}; font-size: ${t.fontSize.small}px;
}
.tg-field, .tg-panel input:not([type]), .tg-panel input[type='text'], .tg-panel input[type='password'],
.tg-panel input[type='number'], .tg-panel select, .tg-panel textarea {
  width: 100%; min-height: ${t.size.fieldHeight}px; padding: 0 ${t.space.lg}px;
  border: 1px solid ${t.color.panelLine}; border-radius: ${t.radius.field}px;
  background: ${t.color.panelTile}; color: ${t.color.panelText};
  font-family: ${t.font.ui}; font-size: ${t.fontSize.field}px;
}
.tg-panel textarea { padding: ${t.space.md}px ${t.space.lg}px; resize: vertical; }
.tg-panel input[type='color'] { width: 64px; height: ${t.size.fieldHeight}px; padding: ${t.space.xxs}px; }
.tg-panel ::placeholder { color: ${t.color.panelMuted}; opacity: 1; }
.tg-check { display: flex !important; align-items: center; gap: ${t.space.sm}px; }
.tg-check > span { margin: 0 !important; color: ${t.color.panelText} !important; font-size: ${t.fontSize.body}px !important; }
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
.tg-choice__name { font-family: ${t.font.pixel}; letter-spacing: ${t.letterSpacing.pixel}px; font-size: ${t.fontSize.roomName}px; font-weight: ${t.fontWeight.bold}; text-transform: uppercase; }
.tg-warning { display: flex; gap: ${t.space.sm}px; align-items: flex-start; margin: ${t.space.lg}px 0 0; font-size: ${t.fontSize.body}px; font-weight: ${t.fontWeight.semibold}; }
.tg-tools { list-style: none; margin: 0; padding: 0; }
.tg-tools li { display: flex; align-items: center; gap: ${t.space.lg}px; padding: ${t.space.md}px 0; border-bottom: 1px solid ${t.color.panelLine}; }
.tg-tools li > span { flex: 1; }
.tg-tools small { color: ${t.color.panelMuted}; font-size: ${t.fontSize.small}px; }
.tg-switch {
  display: inline-flex; align-items: center; gap: ${t.space.xs}px; min-width: 64px; height: 32px;
  padding: 0 ${t.space.lg}px; border-radius: ${t.radius.field}px; border: 1px solid ${t.color.panelMuted};
  background: transparent; color: ${t.color.panelMuted}; font-family: ${t.font.ui};
  font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold}; cursor: pointer;
}
.tg-switch[aria-checked='true'] { background: ${t.color.gold}; border-color: ${t.color.gold}; color: ${t.color.goldInk}; }
.tg-brain { display: flex; flex-wrap: wrap; align-items: center; gap: ${t.space.md}px; margin: 0 0 ${t.space.lg}px; }
.tg-pet { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: ${t.space.xl}px; align-items: start; }
.tg-card {
  position: sticky; top: 0; background: ${t.color.sidebar}; color: ${t.color.text};
  border-radius: ${t.radius.row}px; padding: ${t.space.xl}px;
}
.tg-card h3 { color: ${t.color.textMuted}; margin-top: 0; font-size: ${t.fontSize.min}px; }
.tg-card__who { display: flex; gap: ${t.space.lg}px; align-items: center; margin-bottom: ${t.space.lg}px; }
.tg-card dl { margin: 0; font-size: ${t.fontSize.small}px; }
.tg-card dl div { padding: ${t.space.xs}px 0; border-top: 1px solid ${t.color.line}; }
.tg-card dt { display: inline; color: ${t.color.textMuted}; }
.tg-card dd { display: inline; margin: 0; }
.tg-card p { color: ${t.color.textMuted}; font-size: ${t.fontSize.small}px; margin: ${t.space.lg}px 0 0; }
.tg-footer { display: flex; flex-wrap: wrap; align-items: center; gap: ${t.space.md}px; }
.tg-footer p { flex-basis: 100%; margin: 0; color: ${t.color.textMuted}; font-size: ${t.fontSize.small}px; }
`;
