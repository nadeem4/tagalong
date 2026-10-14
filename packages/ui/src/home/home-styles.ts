import { officeTokens as t } from '../office/tokens';

/**
 * Home's chrome: the frame, the top bar, the right panel's tabs, the activity list and the
 * agent controls, built from the office tokens and scoped under `.home`. Nothing here
 * belongs to a theme; a theme's scene brings its own look.
 */
export const HOME_CSS = `
.home {
  height: 100%; display: flex; overflow: hidden;
  background: ${t.color.panel}; color: ${t.color.panelText}; font-family: ${t.font.ui};
}
.home-nav {
  width: 232px; flex: none; display: flex; flex-direction: column; gap: ${t.space.xs}px;
  padding: ${t.space.xxl}px ${t.space.lg}px; background: ${t.color.sidebar}; color: ${t.color.text};
}
.home-nav__who { display: flex; align-items: center; gap: ${t.space.lg}px; padding: 0 ${t.space.sm}px ${t.space.xl}px; }
.home-nav__who span:last-child { display: flex; flex-direction: column; gap: 2px; }
.home-nav__who strong { font-family: ${t.font.pixel}; font-size: 18px; letter-spacing: 0.5px; }
.home-nav__who small { font-size: ${t.fontSize.small}px; color: #7CB8F2; }
.home-nav__tile {
  width: 56px; height: 56px; flex: none; display: flex; align-items: center; justify-content: center;
  border-radius: ${t.radius.tile}px; background: #222845;
}
.home-nav__item {
  height: ${t.size.fieldHeight}px; padding: 0 ${t.space.lg}px; border: 0; border-radius: ${t.radius.field}px;
  background: transparent; color: ${t.color.textMuted}; text-align: left; cursor: pointer;
  font-family: ${t.font.ui}; font-size: ${t.fontSize.field}px;
}
.home-nav__item:hover { color: ${t.color.text}; }
.home-nav__item[aria-current='page'] { background: #1E2442; color: ${t.color.text}; font-weight: ${t.fontWeight.semibold}; }
.home-main {
  flex: 1; min-width: 0; overflow-y: auto; display: flex; flex-direction: column;
  gap: ${t.space.xxl}px; padding: ${t.space.xxxl}px 32px;
}
.home-title { margin: 0; font-size: 20px; font-weight: ${t.fontWeight.semibold}; }
.home-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: ${t.space.xl}px; }
.home-card {
  display: flex; flex-direction: column; gap: ${t.space.md}px; padding: ${t.space.xl}px ${t.space.xxl}px;
  border: 1px solid ${t.color.panelLine}; border-radius: 12px; background: #fff;
}
.home-card p { margin: 0; font-size: ${t.fontSize.body}px; color: ${t.color.panelMuted}; }
.home-card .tg-btn-quiet { align-self: flex-start; }
.home-card__label {
  margin: 0; font-family: ${t.font.pixel}; font-size: 12px; font-weight: 400;
  letter-spacing: 1px; color: ${t.color.panelMuted};
}
.home-card__lead { display: flex; align-items: center; gap: ${t.space.md}px; }
.home-card p.home-card__lead { font-size: ${t.fontSize.field}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; }
.home-card p.home-card__row { display: flex; justify-content: space-between; gap: ${t.space.lg}px; color: ${t.color.panelText}; }
.home-card__row span:last-child { flex: none; color: ${t.color.panelMuted}; }
.home-dot { width: 8px; height: 8px; border-radius: 50%; background: #2F9E44; }
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
.home-link {
  padding: 0; border: 0; background: none; cursor: pointer; text-decoration: underline;
  font: inherit; color: ${t.color.link};
}
.home-entry .tg-chip { flex: none; align-self: center; }
.home-switch { display: flex; align-items: flex-start; gap: ${t.space.xl}px; margin: 0 0 ${t.space.lg}px; }
.home-switch > span { flex: 1; display: flex; flex-direction: column; gap: ${t.space.xs}px; }
.home-switch .tg-note { margin: 0; }
.home-switch__label { font-size: ${t.fontSize.field}px; font-weight: ${t.fontWeight.semibold}; }
.home-danger { margin-left: auto; display: flex; gap: ${t.space.md}px; }
.home-conns__list { list-style: none; margin: 0 0 ${t.space.lg}px; padding: 0; display: flex; flex-direction: column; }
.home-conn {
  display: flex; flex-direction: column; gap: ${t.space.md}px;
  padding: ${t.space.lg}px 0; border-bottom: 1px solid ${t.color.panelLine};
}
.home-conn__head { display: flex; align-items: center; gap: ${t.space.lg}px; }
.home-conn__head .tg-chip { flex: none; }
.home-conn__head .tg-error { font-weight: 400; }
.home-conn__actions { display: flex; align-items: center; gap: ${t.space.md}px; }
.home-conn__form { display: flex; flex-direction: column; padding-top: ${t.space.md}px; }
.home-conn__url { overflow-wrap: anywhere; color: ${t.color.panelText}; }
.home-conns details > summary { cursor: pointer; margin: 0; }
.home-conns__advanced { margin-top: ${t.space.xl}px; }
.home-controls { border-radius: 0; }
.home-controls * { box-sizing: border-box; }
.home-controls .tg-pet { grid-template-columns: minmax(0, 1fr); }
.home-controls .tg-card { position: static; }
.home-controls .tg-footer { margin-top: ${t.space.xxl}px; }
.home-controls .tg-footer p { color: ${t.color.panelMuted}; }
`;
