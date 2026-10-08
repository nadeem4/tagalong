import { officeTokens as t } from '../office/tokens';

/**
 * Home's chrome: the frame, the top bar, the right panel's tabs, the activity list and the
 * agent controls, built from the office tokens and scoped under `.home`. Nothing here
 * belongs to a theme; a theme's scene brings its own look.
 */
export const HOME_CSS = `
.home {
  height: 100%; display: flex; flex-direction: column; overflow: hidden;
  background: ${t.color.page}; color: ${t.color.text}; font-family: ${t.font.ui};
}
.home-body { flex: 1; min-height: 0; display: flex; }
.home-bar {
  height: ${t.size.headerHeight}px; flex: none; display: flex; align-items: center;
  gap: ${t.space.xl}px; padding: 0 ${t.space.xxl}px; border-bottom: 1px solid ${t.color.line};
}
.home-bar__title {
  display: flex; align-items: center; gap: ${t.space.md + 2}px;
  width: ${t.size.partyWidth - t.space.xxl - t.space.xl}px;
}
.home-bar__title h1 {
  margin: 0; font-size: ${t.fontSize.title}px; font-weight: ${t.fontWeight.bold};
  letter-spacing: ${t.letterSpacing.title}px;
}
.home-bar__meta {
  display: flex; align-items: center; gap: ${t.space.sm}px; margin-left: ${t.space.md}px;
  font-size: ${t.fontSize.body}px; color: ${t.color.textMuted}; white-space: nowrap;
}
.home-side {
  flex: 1; min-width: 0; display: flex; flex-direction: column;
  background: ${t.color.panel}; color: ${t.color.panelText};
}
.home-tabs {
  flex: none; display: flex; gap: ${t.space.xs}px; padding: 0 ${t.space.lg}px;
  border-bottom: 1px solid ${t.color.panelLine};
}
.home-tab {
  height: ${t.size.fieldHeight}px; padding: 0 ${t.space.lg}px; border: 0;
  border-bottom: 2px solid transparent; background: transparent; cursor: pointer;
  font-family: ${t.font.ui}; font-size: ${t.fontSize.body}px; font-weight: ${t.fontWeight.semibold};
  color: ${t.color.panelMuted}; max-width: 200px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap;
}
.home-tab:hover { color: ${t.color.panelText}; }
.home-tab[aria-selected='true'] { color: ${t.color.panelText}; border-bottom-color: ${t.color.gold}; }
.home-panel { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
.home-panel[hidden] { display: none; }
.home-note {
  margin: 0; padding: ${t.space.xxl}px; font-size: ${t.fontSize.field}px; line-height: 1.5;
  color: ${t.color.panelMuted};
}
.home-activity {
  list-style: none; margin: 0; padding: ${t.space.md}px ${t.space.lg}px;
  display: flex; flex-direction: column; gap: ${t.space.xxs}px;
}
.home-entry {
  display: flex; align-items: flex-start; gap: ${t.space.lg}px; width: 100%;
  padding: ${t.space.md}px; border: 2px solid transparent; border-radius: ${t.radius.row}px;
  background: transparent; cursor: pointer; text-align: left;
  font-family: ${t.font.ui}; color: ${t.color.panelText};
}
.home-entry:hover, .home-entry[aria-expanded='true'] { background: ${t.color.panelTile}; }
.home-entry__tile { flex: none; width: 32px; height: 32px; }
.home-entry__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.home-entry__title { font-size: ${t.fontSize.field}px; font-weight: ${t.fontWeight.semibold}; }
.home-entry__meta {
  display: flex; align-items: center; gap: ${t.space.sm}px;
  font-size: ${t.fontSize.small}px; color: ${t.color.panelMuted};
}
.home-entry__preview {
  font-size: ${t.fontSize.body}px; color: ${t.color.panelMuted};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.home-thread {
  display: flex; flex-direction: column; gap: ${t.space.lg}px;
  margin: ${t.space.xs}px ${t.space.md}px ${t.space.lg}px ${t.space.xxxl * 2 + t.space.xs}px;
  padding: ${t.space.xs}px 0 ${t.space.xs}px ${t.space.xl}px;
  border-left: 2px solid ${t.color.panelLine};
}
.home-said { margin: 0; font-size: ${t.fontSize.body}px; }
.home-said__who {
  display: block; margin-bottom: ${t.space.xs}px;
  font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelMuted};
}
.home-said p { margin: 0; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.home-quiet {
  align-self: flex-start; height: ${t.size.fieldHeight}px; padding: 0 ${t.space.xl}px;
  border-radius: ${t.radius.field}px; border: 1px solid ${t.color.panelMuted};
  background: transparent; color: ${t.color.panelText}; cursor: pointer;
  font-family: ${t.font.ui}; font-size: ${t.fontSize.field}px; font-weight: ${t.fontWeight.semibold};
}
.home-controls { border-radius: 0; }
.home-controls * { box-sizing: border-box; }
.home-controls .tg-pet { grid-template-columns: minmax(0, 1fr); }
.home-controls .tg-card { position: static; }
.home-controls .tg-footer { margin-top: ${t.space.xxl}px; }
.home-controls .tg-footer p { color: ${t.color.panelMuted}; }
`;
