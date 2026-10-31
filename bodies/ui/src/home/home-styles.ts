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
.home-entry__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.home-entry__title { font-size: ${t.fontSize.field}px; font-weight: ${t.fontWeight.semibold}; }
.home-entry__preview {
  font-size: ${t.fontSize.body}px; color: ${t.color.panelMuted};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
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
.home-perms { max-width: 772px; margin: 0 ${t.space.xxl}px ${t.space.xxl}px; }
.perm-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.perm-row {
  display: flex; align-items: center; flex-wrap: wrap; gap: ${t.space.xl}px;
  padding: ${t.space.lg}px 0; border-top: 1px solid ${t.color.panelLine};
}
.perm-row__warning { flex-basis: 100%; display: flex; align-items: center; flex-wrap: wrap; gap: ${t.space.md}px; font-size: ${t.fontSize.body}px; color: ${t.color.panelText}; }
.perm-row__warning p { flex: 1 1 100%; margin: 0; }
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
.apv-section { display: flex; flex-direction: column; gap: ${t.space.lg}px; }
.apv-sub { margin: ${t.space.xs}px 0 0; font-size: ${t.fontSize.body}px; }
.apv-error { color: ${t.color.errInk}; margin: 0; }
.apv-btn {
  height: 28px; padding: 0 ${t.space.md}px; border-radius: ${t.radius.small - 2}px;
  border: 1px solid ${t.color.panelMuted}; background: transparent; color: ${t.color.panelText};
  font-family: ${t.font.ui}; font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold}; cursor: pointer;
}
.apv-btn:hover { background: ${t.color.panelTile}; }
.apv-prefs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${t.space.md}px; }
.apv-pref {
  position: relative; flex-direction: row; align-items: center; justify-content: space-between;
  gap: ${t.space.xl}px; padding: ${t.space.lg}px ${t.space.xl}px ${t.space.lg}px ${t.space.xxl}px;
}
.apv-pref::before {
  content: ''; position: absolute; left: 0; top: ${t.space.lg}px; bottom: ${t.space.lg}px; width: 3px;
  border-radius: 0 3px 3px 0; background: ${t.color.gold};
}
.apv-pref__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xs}px; }
.apv-pref__sentence { font-size: ${t.fontSize.field + 1}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; overflow-wrap: anywhere; }
.apv-pref__meta { display: flex; flex-wrap: wrap; gap: ${t.space.xs}px ${t.space.xl - 2}px; font-size: ${t.fontSize.small}px; color: ${t.color.panelMuted}; }
.apv-pref__meta b { font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; }
.apv-pref__actions { flex: none; display: flex; gap: ${t.space.md}px; }
.apv-pref__edit.tg-panel { flex: 1; min-width: 0; padding: 0; background: transparent; }
.apv-pref__edit label { margin-bottom: ${t.space.md}px; }
.apv-summary { flex-direction: row; align-items: center; gap: ${t.space.xxl}px; padding: ${t.space.lg}px ${t.space.xl}px; }
.apv-summary div { display: flex; flex-direction: column; }
.apv-summary b { font-size: ${t.fontSize.title}px; font-weight: ${t.fontWeight.semibold}; line-height: 1.1; font-variant-numeric: tabular-nums; }
.apv-summary span { font-size: ${t.fontSize.small}px; color: ${t.color.panelMuted}; }
.apv-summary__sep { width: 1px; align-self: stretch; background: ${t.color.panelLine}; }
.apv-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: ${t.space.lg}px; }
.apv-seg { display: inline-flex; gap: ${t.space.xs}px; padding: 3px; border-radius: ${t.radius.row}px; background: ${t.color.panelTile}; }
.apv-seg button {
  height: 28px; padding: 0 ${t.space.lg}px; border: 0; border-radius: 7px; background: transparent;
  color: ${t.color.chipFreeInk}; font-family: ${t.font.ui}; font-size: ${t.fontSize.small}px;
  font-weight: ${t.fontWeight.semibold}; cursor: pointer;
}
.apv-seg button[aria-pressed='true'] { background: #fff; color: ${t.color.panelText}; outline: 1px solid ${t.color.panelLine}; }
.apv-seg__n { margin-left: ${t.space.xs}px; font-weight: 400; color: ${t.color.panelMuted}; }
.apv-day { margin: ${t.space.lg}px 0 ${t.space.sm}px; }
.apv-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.apv-row {
  position: relative; display: grid; grid-template-columns: 48px 20px 1fr auto; align-items: start;
  gap: ${t.space.lg}px; padding: ${t.space.md}px ${t.space.md}px; border: 1px solid transparent; border-radius: ${t.radius.row}px;
}
.apv-row:hover { background: ${t.color.panelTile}; }
.apv-row__time { padding-top: ${t.space.xxs}px; font-size: ${t.fontSize.small}px; color: ${t.color.panelMuted}; font-variant-numeric: tabular-nums; }
.apv-row__icon { width: 16px; height: 16px; margin-top: ${t.space.xs}px; stroke: ${t.color.panelMuted}; fill: none; stroke-width: 1.6; }
.apv-row__body { min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.apv-row__what { font-size: ${t.fontSize.field}px; font-weight: ${t.fontWeight.semibold}; overflow-wrap: anywhere; }
.apv-row__source, .apv-row__by { font-size: ${t.fontSize.small}px; color: ${t.color.panelMuted}; }
.apv-row__by { margin-top: ${t.space.xs}px; }
.apv-row__by b { font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; }
.apv-row__by em { font-style: normal; color: ${t.color.link}; overflow-wrap: anywhere; }
.apv-row__side { display: flex; flex-direction: column; align-items: flex-end; gap: ${t.space.sm}px; }
.apv-row--scout { background: ${t.color.panelTile}; border-color: ${t.color.panelLine}; }
.apv-row--scout::before {
  content: ''; position: absolute; left: -1px; top: ${t.space.md}px; bottom: ${t.space.md}px; width: 3px;
  border-radius: 3px; background: ${t.color.page};
}
.apv-pill {
  padding: ${t.space.xxs}px ${t.space.md}px; border-radius: ${t.radius.chip}px; background: ${t.color.page};
  color: ${t.color.text}; font-size: ${t.fontSize.min}px; font-weight: ${t.fontWeight.semibold};
}
.apv-more { align-self: flex-start; }
.home-controls { border-radius: 0; }
.home-controls * { box-sizing: border-box; }
.home-controls .tg-footer { margin-top: ${t.space.xxl}px; }
.home-controls .tg-footer p { color: ${t.color.panelMuted}; }
`;
