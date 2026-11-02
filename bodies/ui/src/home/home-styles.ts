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
.home-nav__who strong { font-family: ${t.font.wordmark}; font-weight: ${t.fontWeight.wordmark}; font-size: 18px; }
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
  flex: 1; min-width: 0; overflow-y: auto; scrollbar-gutter: stable; display: flex; flex-direction: column;
  padding: ${t.space.xxxl}px 0;
}
/* One width and one inset for every tab, so the left edge never jumps between pages. */
.home-page { max-width: 920px; width: 100%; margin: 0 auto; box-sizing: border-box;
  padding: 0 ${t.space.page}px; display: flex; flex-direction: column; gap: ${t.space.xxl}px;
}
.home-page > * { min-width: 0; }
.home-head { display: flex; flex-direction: column; gap: ${t.space.xs}px; }
.home-head p { margin: 0; font-size: ${t.fontSize.field}px; color: ${t.color.panelMuted}; }
.home-time { white-space: nowrap; font-variant-numeric: tabular-nums; }
.home-title { margin: 0; font-size: 22px; font-weight: ${t.fontWeight.semibold}; }
.home-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: ${t.space.xl}px; }
.home-card {
  display: flex; flex-direction: column; gap: ${t.space.md}px; padding: ${t.space.xl}px ${t.space.xxl}px;
  border: 1px solid ${t.color.panelLine}; border-radius: 12px; background: #fff;
}
.home-card p { margin: 0; font-size: ${t.fontSize.body}px; color: ${t.color.panelMuted}; }
.home-card .tg-button--secondary { align-self: flex-end; }
.home-card__label {
  margin: 0; font-family: ${t.font.pixel}; font-size: 12px; font-weight: 400;
  letter-spacing: 1px; color: ${t.color.panelMuted};
}
.home-card__lead { display: flex; align-items: center; gap: ${t.space.md}px; }
.home-card p.home-card__lead { font-size: ${t.fontSize.field}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; }
.home-card p.home-card__row { display: flex; justify-content: space-between; gap: ${t.space.lg}px; color: ${t.color.panelText}; }
.home-card--run .home-card__row strong { min-width: 0; overflow-wrap: anywhere; }
.home-card__row:not(.home-card__row--app) > span:last-child { flex: none; color: ${t.color.panelMuted}; }
.home-card--run p.home-card__row { align-items: center; padding: ${t.space.md}px 0; border-top: 1px solid ${t.color.panelLine}; }
.home-card--run p.home-card__row--app { justify-content: flex-start; }
.home-card--run .home-card__row--app .home-entry__body { gap: 0; }
.home-card--run .home-card__row--app .tg-chip { flex: none; margin-left: auto; }
.home-card--run .tg-chip .home-dot { margin-right: 0; }
.home-card--run .home-card__row:not(.home-card__row--app) > span:last-child {
  padding: 2px ${t.space.md}px; border-radius: 999px; background: ${t.color.panelTile};
  font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText};
}
.home-spend { font-size: 26px; font-weight: ${t.fontWeight.semibold}; font-variant-numeric: tabular-nums; }
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
.home-conns__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.home-conns__list > li:last-child .home-conn { border-bottom: 0; padding-bottom: 0; }
.home-conn {
  display: flex; flex-direction: column; gap: ${t.space.md}px;
  padding: ${t.space.lg}px 0; border-bottom: 1px solid ${t.color.panelLine};
}
.home-conn__head { display: flex; align-items: center; gap: ${t.space.lg}px; }
.home-conn__initial {
  width: 36px; height: 36px; flex: none; display: flex; align-items: center; justify-content: center;
  border-radius: ${t.radius.row}px; background: ${t.color.panelTile}; font-weight: ${t.fontWeight.semibold};
}
.home-conn__head .home-entry__title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.home-conn__head .tg-chip { flex: none; }
.home-conn__head .tg-error { font-weight: 400; }
.home-conn__actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: ${t.space.md}px; }
.home-conn__form { display: flex; flex-direction: column; padding-top: ${t.space.md}px; }
.home-conns details > summary { cursor: pointer; margin: 0; }
.home-conns__form-host.tg-panel { padding: 0; background: transparent; }
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
.job-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.job-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; column-gap: ${t.space.xl}px;
  padding: ${t.space.lg}px 0; border-top: 1px solid ${t.color.panelLine};
}
.job-row__main { min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xs}px; }
.job-row__task {
  font-size: ${t.fontSize.field + 1}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.job-row__meta { display: flex; align-items: center; gap: ${t.space.md}px; min-width: 0; }
.job-row__where { min-width: 0; font-size: ${t.fontSize.body}px; color: ${t.color.panelMuted}; overflow-wrap: anywhere; }
.job-row__state {
  flex: none; padding: 1px ${t.space.md}px; border-radius: 999px; background: ${t.color.panelTile};
  font-size: ${t.fontSize.small}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText};
}
.job-row__state--running { background: ${t.color.warnFill}; color: ${t.color.warnInk}; }
.job-row__state--done { background: ${t.color.okFill}; color: ${t.color.okInk}; }
.job-row__state--error { background: ${t.color.errFill}; color: ${t.color.errInk}; }
.job-row__text { font-size: ${t.fontSize.body}px; color: ${t.color.panelMuted}; line-height: 1.4; overflow-wrap: anywhere; }
.job-row__actions { display: flex; gap: ${t.space.lg}px; }
.job-row__result {
  grid-column: 1 / -1; margin: ${t.space.md}px 0 0; padding: ${t.space.md}px; white-space: pre-wrap; overflow-wrap: anywhere;
  font: inherit; font-size: ${t.fontSize.body}px; color: ${t.color.panelText}; border: 1px solid ${t.color.panelLine}; border-radius: 8px;
}
.job-page__back {
  align-self: flex-start; margin: 0 0 ${t.space.xs}px; padding: 0; border: 0; background: none; cursor: pointer;
  font: inherit; font-size: ${t.fontSize.body}px; font-weight: ${t.fontWeight.semibold}; color: ${t.color.link};
}
.job-page__back::before { content: '\\2039' / ''; margin-right: ${t.space.sm}px; }
.job-page__back:hover { text-decoration: underline; }
.job-page__title { display: flex; align-items: center; flex-wrap: wrap; gap: ${t.space.md}px ${t.space.lg}px; }
.job-page__title .home-title { min-width: 0; overflow-wrap: anywhere; }
.job-page__title .tg-button { margin-left: auto; }
.job-page__time { font-size: ${t.fontSize.body}px; color: ${t.color.panelMuted}; font-variant-numeric: tabular-nums; }
.job-page__alert {
  margin: 0; padding: ${t.space.md}px ${t.space.lg}px; border-radius: ${t.radius.field}px;
  background: ${t.color.errFill}; color: ${t.color.errInk}; font-size: ${t.fontSize.body}px;
}
.job-page__frame { position: relative; }
.job-page__jump {
  position: absolute; left: 50%; bottom: ${t.space.lg}px; transform: translateX(-50%);
  min-height: 32px; padding: 0 ${t.space.xl}px; border: 0; border-radius: 999px; cursor: pointer;
  background: ${t.color.gold}; color: ${t.color.goldInk}; font: inherit; font-size: ${t.fontSize.body}px; font-weight: ${t.fontWeight.semibold};
}
.job-log {
  /* 240px is roughly the head, nav gaps and page padding above the log, so it fills the rest. */
  height: calc(100vh - 240px); min-height: 280px; overflow-y: auto; overscroll-behavior: contain;
  padding: ${t.space.lg}px ${t.space.xl}px; border: 1px solid ${t.color.line}; border-radius: ${t.radius.row}px;
  background: ${t.color.page}; color: ${t.color.text};
  font-family: ${t.font.mono}; font-size: ${t.fontSize.small}px; line-height: 1.55;
}
.job-log__line { display: flex; gap: ${t.space.md}px; white-space: pre-wrap; overflow-wrap: anywhere; }
.job-log__cmd { margin-top: ${t.space.md}px; font-weight: ${t.fontWeight.semibold}; }
.job-log__meta { font-weight: 400; color: ${t.color.textMuted}; }
.job-log__exit { font-weight: 400; }
.job-log__exit--ok { color: ${t.ansi.green}; }
.job-log__exit--err { color: ${t.ansi.red}; }
.job-log__note { margin-left: ${t.space.xxl}px; color: ${t.color.textMuted}; }
.job-log__glyph { flex: none; width: 12px; text-align: center; font-weight: ${t.fontWeight.bold}; }
.job-log__glyph--done { color: ${t.ansi.green}; }
.job-log__glyph--failed { color: ${t.ansi.red}; }
.job-log__glyph--pending { color: ${t.color.textMuted}; }
.job-log__glyph--running { color: ${t.color.gold}; }
.job-log__glyph--running[data-motion='on'] { display: inline-block; animation: job-log-spin 1s linear infinite; }
@keyframes job-log-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .job-log__glyph--running[data-motion='on'] { animation: none; } }
.job-log__out, .job-log__plan {
  margin: 0 0 ${t.space.sm}px 20px; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; color: ${t.color.textMuted};
}
.job-log__edit { color: ${t.color.sky}; }
.job-log__quiet, .job-log__say { color: ${t.color.textMuted}; white-space: pre-wrap; overflow-wrap: anywhere; }
.job-log__say { margin-top: ${t.space.md}px; }
.job-log__end { margin-top: ${t.space.lg}px; font-weight: ${t.fontWeight.semibold}; }
.ansi-bold { font-weight: ${t.fontWeight.semibold}; }
.ansi-black { color: ${t.ansi.black}; }
.ansi-red { color: ${t.ansi.red}; }
.ansi-green { color: ${t.ansi.green}; }
.ansi-yellow { color: ${t.ansi.yellow}; }
.ansi-blue { color: ${t.ansi.blue}; }
.ansi-magenta { color: ${t.ansi.magenta}; }
.ansi-cyan { color: ${t.ansi.cyan}; }
.ansi-white { color: ${t.ansi.white}; }
.ansi-brightBlack { color: ${t.ansi.brightBlack}; }
.ansi-brightRed { color: ${t.ansi.brightRed}; }
.ansi-brightGreen { color: ${t.ansi.brightGreen}; }
.ansi-brightYellow { color: ${t.ansi.brightYellow}; }
.ansi-brightBlue { color: ${t.ansi.brightBlue}; }
.ansi-brightMagenta { color: ${t.ansi.brightMagenta}; }
.ansi-brightCyan { color: ${t.ansi.brightCyan}; }
.ansi-brightWhite { color: ${t.ansi.brightWhite}; }
.apv-section {
  display: flex; flex-direction: column; gap: ${t.space.lg}px; padding: ${t.space.xl}px ${t.space.xxl}px;
  border: 1px solid ${t.color.panelLine}; border-radius: 12px; background: #fff;
}
.apv-error { color: ${t.color.errInk}; margin: 0; }
.apv-prefs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.apv-pref.home-card {
  flex-direction: row; align-items: center; justify-content: space-between; gap: ${t.space.xl}px;
  padding: ${t.space.lg}px 0; border: 0; border-top: 1px solid ${t.color.panelLine}; border-radius: 0;
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
  position: relative; display: grid; grid-template-columns: 56px 20px 1fr auto; align-items: start;
  gap: ${t.space.lg}px; padding: ${t.space.md}px ${t.space.md}px; border: 1px solid transparent; border-radius: ${t.radius.row}px;
}
.apv-row:hover { background: ${t.color.panelTile}; }
.apv-row__time { white-space: nowrap; padding-top: ${t.space.xxs}px; font-size: ${t.fontSize.small}px; color: ${t.color.panelMuted}; font-variant-numeric: tabular-nums; }
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
`;
