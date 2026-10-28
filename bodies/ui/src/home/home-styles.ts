/**
 * Home's stylesheet: the frame, the side nav, the pages, the activity list and the forms,
 * built from the design tokens and scoped under `.home`. Contains HOME_CSS.
 */
import { themeTokens as t } from '../theme/tokens';

export const HOME_CSS = `
.home {
  height: 100%; display: flex; overflow: hidden;
  background: ${t.color.panel}; color: ${t.color.panelText}; font-family: ${t.font.ui};
}
.home :focus-visible {
  outline: ${t.size.focusRing}px solid ${t.color.gold}; outline-offset: ${t.size.focusOffset}px;
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
  border-radius: ${t.radius.tile}px; background: #222845; overflow: hidden;
}
/* Bean sits a little left of and below a frame's centre: nudge it into the middle of the tile. */
.home-nav__tile > span { flex: none; transform: translate(2px, -6px); }
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
.home-page { display: contents; }
.home-page[hidden] { display: none; }
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
.home-card--run .home-card__row strong { min-width: 0; overflow-wrap: anywhere; }
.home-card__row span:last-child { flex: none; color: ${t.color.panelMuted}; }
.home-dot { width: 8px; height: 8px; border-radius: 50%; background: #2F9E44; }
.home-dot--warn { background: ${t.color.gold}; }
.home-dot--err { background: ${t.color.errInk}; }
.home-dot--off { background: ${t.color.panelMuted}; }
.tg-chip .home-dot { display: inline-block; }
.home-card--run .home-dot { display: inline-block; margin-right: 6px; }
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
.home-entry__tile {
  flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.home-entry__tile > span { flex: none; transform: translate(1px, -3px); }
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
.home-learned { display: flex; flex-direction: column; gap: ${t.space.lg}px; padding: ${t.space.xxl}px; min-height: 0; }
.home-learned__night { margin: 0; font-size: ${t.fontSize.body}px; color: ${t.color.panelMuted}; line-height: 1.5; }
.home-learned__body { display: flex; gap: ${t.space.xl}px; min-height: 0; flex-wrap: wrap; }
.home-learned__pages { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.home-learned__page {
  width: 100%; padding: ${t.space.sm}px ${t.space.md}px; border: 0; border-radius: ${t.radius.row}px;
  background: transparent; cursor: pointer; text-align: left;
  font-family: ${t.font.ui}; font-size: ${t.fontSize.body}px; color: ${t.color.panelText};
}
.home-learned__page:hover, .home-learned__page[aria-pressed='true'] { background: ${t.color.panelTile}; }
.home-learned__open { flex: 1; min-width: 260px; display: flex; flex-direction: column; gap: ${t.space.md}px; }
.home-learned__text {
  min-height: 220px; resize: vertical; padding: ${t.space.md}px;
  border: 1px solid ${t.color.panelLine}; border-radius: ${t.radius.row}px;
  font-family: ${t.font.ui}; font-size: ${t.fontSize.body}px; line-height: 1.5; color: ${t.color.panelText};
}
.home-learned__actions { display: flex; align-items: center; gap: ${t.space.md}px; font-size: ${t.fontSize.small}px; color: ${t.color.panelMuted}; }
.home-learned__changes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${t.space.md}px; font-size: ${t.fontSize.body}px; }
.home-learned__changes li { display: flex; flex-direction: column; gap: ${t.space.xxs}px; align-items: flex-start; }
.home-learned__waiting { display: block; padding: 0 ${t.space.md}px; font-size: ${t.fontSize.small}px; color: ${t.color.panelMuted}; }
.home-learned__version {
  margin: 0; padding: ${t.space.sm}px ${t.space.md}px; max-height: 240px; overflow: auto; align-self: stretch;
  border: 1px solid ${t.color.panelLine}; border-radius: ${t.radius.row}px;
  font-family: ${t.font.ui}; font-size: ${t.fontSize.small}px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere;
}
.home-ask__details {
  align-self: stretch; max-height: 160px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere;
  font-size: ${t.fontSize.small}px; line-height: 1.5; color: ${t.color.panelMuted};
}
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
.home-conns details > summary { cursor: pointer; margin: 0; }
.home-conns__advanced { margin-top: ${t.space.xl}px; }
.home-templates {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: ${t.space.md}px;
  margin: 0 0 ${t.space.xl}px;
}
.home-template {
  display: flex; flex-direction: column; gap: ${t.space.xs}px; padding: ${t.space.lg}px ${t.space.xl}px;
  border: 2px solid ${t.color.panelLine}; border-radius: ${t.radius.row}px; background: #fff;
  color: ${t.color.panelText}; font-family: ${t.font.ui}; text-align: left; cursor: pointer;
}
.home-template:hover { background: ${t.color.panelTile}; }
.home-template__name { font-size: ${t.fontSize.field}px; font-weight: ${t.fontWeight.semibold}; }
.home-template__line { font-size: ${t.fontSize.small}px; color: ${t.color.panelMuted}; line-height: 1.4; }
.home-routine__when { display: flex; flex-wrap: wrap; gap: ${t.space.lg}px; }
.home-routine__when label { flex: 1 1 200px; }
.home-routine input[type='time'] {
  width: 100%; min-height: ${t.size.fieldHeight}px; padding: 0 ${t.space.lg}px;
  border: 1px solid ${t.color.panelLine}; border-radius: ${t.radius.field}px;
  background: ${t.color.panelTile}; color: ${t.color.panelText};
  font-family: ${t.font.ui}; font-size: ${t.fontSize.field}px;
}
.home-days { display: flex; flex-wrap: wrap; gap: ${t.space.sm}px; margin: 0 0 ${t.space.lg}px; }
.home-day {
  min-width: 52px; height: 32px; padding: 0 ${t.space.md}px; border-radius: ${t.radius.field}px;
  border: 1px solid ${t.color.panelMuted}; background: transparent; color: ${t.color.panelText};
  font-family: ${t.font.ui}; font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold}; cursor: pointer;
}
.home-day[aria-pressed='true'] { background: ${t.color.gold}; border-color: ${t.color.gold}; color: ${t.color.goldInk}; }
.home-routine__more { align-self: flex-start; margin: 0 0 ${t.space.lg}px; font-size: ${t.fontSize.small}px; }
.home-routine__deliver { margin: 0 0 ${t.space.lg}px; padding: 0; border: 0; }
.home-routine__deliver legend {
  margin-bottom: ${t.space.xs}px; padding: 0; color: ${t.color.panelMuted}; font-size: ${t.fontSize.small}px;
}
.home-routine__deliver .tg-check { margin-bottom: ${t.space.sm}px; }
.home-routine__runs { flex-wrap: wrap; margin: 0; }
.home-perms { max-width: 772px; margin: 0 ${t.space.xxl}px ${t.space.xxl}px; }
.perm-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.perm-row {
  display: flex; align-items: center; gap: ${t.space.xl}px;
  padding: ${t.space.lg}px 0; border-top: 1px solid ${t.color.panelLine};
}
.perm-row__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.perm-row__name { font-size: ${t.fontSize.field}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; overflow-wrap: anywhere; }
.perm-row__text { font-size: ${t.fontSize.body}px; color: ${t.color.panelMuted}; line-height: 1.4; }
.perm-row__note { font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelMuted}; }
.perm-row--offline .perm-row__name, .perm-row--offline .perm-row__text { opacity: 0.6; }
.perm-row .tg-switch { flex: none; }
.perm-row .tg-switch:disabled { opacity: 0.55; cursor: not-allowed; }
.home-jobs { max-width: 772px; margin: 0 ${t.space.xxl}px ${t.space.xxl}px; }
.job-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.job-row {
  display: flex; flex-direction: column; gap: ${t.space.xs}px;
  padding: ${t.space.lg}px 0; border-top: 1px solid ${t.color.panelLine};
}
.job-row__head { display: flex; align-items: baseline; gap: ${t.space.lg}px; justify-content: space-between; }
.job-row__task { font-size: ${t.fontSize.field}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; overflow-wrap: anywhere; }
.job-row__state {
  flex: none; padding: 1px ${t.space.md}px; border: 1px solid ${t.color.panelMuted};
  border-radius: 999px; font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText};
}
.job-row__state--running { background: ${t.color.gold}; border-color: ${t.color.gold}; color: ${t.color.goldInk}; }
.job-row__meta, .job-row__text { font-size: ${t.fontSize.body}px; color: ${t.color.panelMuted}; line-height: 1.4; overflow-wrap: anywhere; }
.job-row__actions { display: flex; gap: ${t.space.lg}px; }
.job-row__result {
  margin: 0; padding: ${t.space.md}px; white-space: pre-wrap; overflow-wrap: anywhere;
  font: inherit; font-size: ${t.fontSize.body}px; color: ${t.color.panelText}; border: 1px solid ${t.color.panelLine}; border-radius: 8px;
}
.home-controls { border-radius: 0; }
.home-controls * { box-sizing: border-box; }
.home-controls .tg-footer { margin-top: ${t.space.xxl}px; }
.home-controls .tg-footer p { color: ${t.color.panelMuted}; }
`;
