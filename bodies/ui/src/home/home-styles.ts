/**
 * Home's stylesheet: the frame, the side nav, the pages, the activity list and the forms,
 * built from the design tokens and scoped under `.home`. Contains HOME_CSS.
 */
import { themeTokens as t, typeCss } from '../theme/tokens';

export const HOME_CSS = `
.home {
  height: 100%; display: flex; overflow: hidden;
  background: ${t.color.panel}; color: ${t.color.panelText}; font-family: ${t.font.ui};
}
.home :focus-visible {
  outline: ${t.size.focusRing}px solid var(--tg-focus); outline-offset: ${t.size.focusOffset}px;
}
.home-nav {
  width: 232px; flex: none; display: flex; flex-direction: column; gap: ${t.space.xs}px;
  padding: ${t.space.xxl}px ${t.space.lg}px; background: ${t.color.sidebar}; color: ${t.color.text};
}
.home-nav__who { display: flex; align-items: center; gap: ${t.space.lg}px; padding: 0 ${t.space.sm}px ${t.space.xl}px; }
.home-nav__who span:last-child { display: flex; flex-direction: column; gap: 2px; }
.home-nav__who strong { font-family: ${t.font.wordmark}; ${typeCss('title')}; }
.home-nav__who small { ${typeCss('small')}; color: #7CB8F2; }
.home-nav__tile {
  width: 56px; height: 56px; flex: none; display: flex; align-items: center; justify-content: center;
  border-radius: ${t.radius.tile}px; background: #222845; overflow: hidden;
}
/* Bean sits a little left of and below a frame's centre: nudge it into the middle of the tile. */
.home-nav__tile > span { flex: none; transform: translate(2px, -6px); }
.home-nav__item {
  height: ${t.size.fieldHeight}px; padding: 0 ${t.space.lg}px; border: 0; border-radius: ${t.radius.field}px;
  background: transparent; color: ${t.color.textMuted}; text-align: left; cursor: pointer;
  font-family: ${t.font.ui}; ${typeCss('bodyLead')};
}
.home-nav__badge {
  margin-left: ${t.space.md}px; padding: 1px ${t.space.md}px; border-radius: 999px;
  background: ${t.color.gold}; color: ${t.color.goldInk}; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold};
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
/* At least the free height, so a page that wants it (the job log) can fill what the head leaves. */
.home-page { flex: 1 0 auto; }
.home-head { display: flex; flex-direction: column; gap: ${t.space.xs}px; }
.home-head p { margin: 0; ${typeCss('bodyLead')}; color: ${t.color.panelMuted}; }
.home-time { white-space: nowrap; font-variant-numeric: tabular-nums; }
.home-title { margin: 0; ${typeCss('heading')}; }
.home-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: ${t.space.xl}px; }
.home-card {
  display: flex; flex-direction: column; gap: ${t.space.md}px; padding: ${t.space.xl}px ${t.space.xxl}px;
  border: 1px solid ${t.color.panelLine}; border-radius: 12px; background: #fff;
}
.home-card p { margin: 0; ${typeCss('body')}; color: ${t.color.panelMuted}; }
.home-card .tg-button--secondary { align-self: flex-end; }
.home-card__label {
  margin: 0; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText};
}
.home-card__lead { display: flex; align-items: center; gap: ${t.space.md}px; }
.home-card p.home-card__lead { ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; }
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
  ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText};
}
.home-card__group {
  margin: ${t.space.xl}px 0 0; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelMuted};
}
.home-reading__fix {
  margin: 0 0 ${t.space.md}px; padding: ${t.space.lg}px; border-radius: ${t.radius.row}px;
  background: ${t.color.warnFill}; display: flex; flex-direction: column; gap: ${t.space.md}px;
}
.home-card .home-reading__fix p { color: ${t.color.warnInk}; }
.home-reading__actions { display: flex; align-items: center; flex-wrap: wrap; gap: ${t.space.lg}px; }
.home-reading__actions .job-overview__link { color: ${t.color.warnInk}; }
.home-spend { ${typeCss('display')}; font-variant-numeric: tabular-nums; }
.home-dot { width: 8px; height: 8px; border-radius: 50%; background: #2F9E44; }
.home-dot--warn { background: ${t.color.gold}; }
.home-dot--err { background: ${t.color.errInk}; }
.home-dot--off { background: ${t.color.panelMuted}; }
.tg-chip .home-dot { display: inline-block; }
.home-card--run .home-dot { display: inline-block; margin-right: 6px; }
.home-note {
  margin: 0; padding: ${t.space.xxl}px; ${typeCss('bodyLead')};
  color: ${t.color.panelMuted};
}
.home-activity {
  list-style: none; margin: 0; padding: ${t.space.md}px ${t.space.lg}px;
  display: flex; flex-direction: column; gap: ${t.space.xxs}px;
}
.home-entry__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.home-entry__title { ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; }
.home-entry__preview {
  ${typeCss('body')}; color: ${t.color.panelMuted};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.home-danger { margin-left: auto; display: flex; gap: ${t.space.md}px; }
.home-conn__initial {
  width: 36px; height: 36px; flex: none; display: flex; align-items: center; justify-content: center;
  border-radius: ${t.radius.row}px; background: ${t.color.panelTile}; font-weight: ${t.fontWeight.semibold};
}
/* Scout's brain card and the update prompt. */
.brain-card__title { margin: 0; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; }
.brain-facts { display: grid; grid-template-columns: 140px 1fr; margin: 0; border-top: 1px solid ${t.color.panelLine}; }
.brain-facts dt, .brain-facts dd {
  padding: ${t.space.md}px 0; border-bottom: 1px solid ${t.color.panelLine};
  ${typeCss('body')};
}
.brain-facts dt { color: ${t.color.panelMuted}; }
.brain-facts dd {
  margin: 0; min-width: 0; display: flex; align-items: center; flex-wrap: wrap;
  gap: ${t.space.xs}px ${t.space.lg}px; overflow-wrap: anywhere; color: ${t.color.panelText};
}
.brain-facts--dim dd { color: ${t.color.panelMuted}; }
.brain-status { display: inline-flex; align-items: center; gap: ${t.space.md}px; }
.brain-mono { font-family: ${t.font.mono}; ${typeCss('small')}; }
.brain-chips { display: inline-flex; flex-wrap: wrap; gap: ${t.space.sm}px; }
.brain-link {
  border: 0; background: none; padding: 0; cursor: pointer; font: inherit;
  color: ${t.color.panelText}; text-decoration: underline;
}
.brain-foot { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: ${t.space.md}px; }
.brain-foot__note { margin-right: auto; ${typeCss('small')}; }
.brain-error {
  display: flex; align-items: center; gap: ${t.space.lg}px; padding: ${t.space.lg}px;
  border-radius: ${t.radius.row}px; background: ${t.color.errFill}; color: ${t.color.errInk};
}
.brain-error > span { flex: 1; }
.brain-icon { width: 16px; height: 16px; flex: none; }
.brain-update p.brain-update__title { display: flex; align-items: center; gap: ${t.space.md}px; }
.brain-meta { color: ${t.color.panelMuted}; ${typeCss('small')}; }
.brain-update {
  display: flex; flex-direction: column; gap: ${t.space.md}px; padding: ${t.space.lg}px;
  border-radius: ${t.radius.row}px; background: ${t.color.warnFill};
}
.home-card .brain-update p, .brain-update p { margin: 0; color: ${t.color.warnInk}; ${typeCss('body')}; }
.brain-update p.brain-update__title { font-weight: ${t.fontWeight.semibold}; }
.brain-update__foot { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: ${t.space.md}px; }
.brain-update__foot .brain-update__note { margin-right: auto; ${typeCss('small')}; }
.home-page > .brain-update { margin-bottom: ${t.space.xl}px; }
.perm-group { margin-top: ${t.space.xl}px; }
.perm-group__title { margin: 0 0 ${t.space.xs}px; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelMuted}; }
.perm-search {
  display: flex; align-items: center; gap: 10px; box-sizing: border-box; height: 40px;
  margin-top: ${t.space.lg}px; padding: 0 ${t.space.lg}px; border: 1px solid var(--tg-ctl-line);
  border-radius: ${t.radius.field}px; background: ${t.color.controlFill}; color: ${t.color.panelMuted};
}
.perm-search:focus-within { outline: ${t.size.focusRing}px solid var(--tg-focus); outline-offset: ${t.size.focusOffset}px; }
.perm-search .tg-icon { flex: none; }
.perm-search input:focus-visible { outline: none; }
.perm-search input::-webkit-search-cancel-button { appearance: none; }
.perm-search input {
  flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: none; background: transparent;
  color: ${t.color.panelText}; font-family: ${t.font.ui}; ${typeCss('bodyLead')};
}
.perm-grps { display: flex; flex-direction: column; border-top: 1px solid ${t.color.panelLine}; margin-top: ${t.space.lg}px; }
.perm-grp { border-bottom: 1px solid ${t.color.panelLine}; }
.perm-grp__head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; width: 100%; box-sizing: border-box;
  padding: 12px 4px; border: 0; background: transparent; color: ${t.color.panelText}; cursor: pointer;
  text-align: left; font-family: ${t.font.ui}; ${typeCss('bodyLead')};
}
.perm-grp__chev { flex: none; display: inline-flex; color: ${t.color.panelMuted}; }
.perm-grp__name { font-weight: ${t.fontWeight.semibold}; }
.perm-grp__sum { margin-right: auto; ${typeCss('body')}; color: ${t.color.panelMuted}; }
.home-card p.perm-grp__note { margin: -4px 0 ${t.space.xs}px 30px; ${typeCss('small')}; color: ${t.color.panelMuted}; }
.perm-chip {
  display: inline-flex; align-items: center; flex: none; height: 20px; padding: 0 ${t.space.md}px;
  border-radius: 10px; ${typeCss('caption')}; box-sizing: border-box; white-space: nowrap;
}
.perm-chip--warn { background: ${t.color.warnFill}; color: ${t.color.warnInk}; }
.perm-chip--quiet { background: transparent; color: ${t.color.panelMuted}; border: 1px solid ${t.color.panelLine}; }
.perm-list { list-style: none; margin: 0 0 ${t.space.md}px; padding: 0 0 0 30px; display: flex; flex-direction: column; }
.perm-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 16px;
  padding: 10px 0; border-top: 1px solid ${t.color.panelLine};
}
.perm-list > .perm-row:first-child { border-top: 0; }
.perm-row__warning { grid-column: 1 / -1; display: flex; align-items: center; flex-wrap: wrap; gap: ${t.space.md}px; ${typeCss('body')}; color: ${t.color.panelText}; }
.perm-row__warning p { flex: 1 1 100%; margin: 0; }
.perm-row__body { min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.perm-row__head { display: flex; align-items: center; flex-wrap: wrap; gap: ${t.space.sm}px; }
.perm-row__name { ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; overflow-wrap: anywhere; }
.perm-row__text { ${typeCss('body')}; color: ${t.color.panelMuted}; }
.perm-row--offline .perm-row__name, .perm-row--offline .perm-row__text,
.perm-row--off .perm-row__name, .perm-row--off .perm-row__text { opacity: 0.6; }
.perm-row--risky-auto .tg-three__option[aria-checked='true'] { background: ${t.color.warnFill}; color: ${t.color.warnInk}; }
.perm-info {
  flex: none; width: 18px; height: 18px; padding: 0; border: 1px solid ${t.color.panelLine}; border-radius: 50%;
  background: transparent; color: ${t.color.panelMuted}; cursor: pointer;
  font: italic ${t.fontWeight.semibold} 11px/1 Georgia, serif;
}
.perm-info[aria-expanded='true'] { background: ${t.color.panelText}; border-color: ${t.color.panelText}; color: ${t.color.controlFill}; }
.perm-pop {
  grid-column: 1 / -1; max-width: 62ch; padding: 10px ${t.space.lg}px; border-radius: ${t.radius.tile}px;
  background: ${t.color.panelTile}; color: ${t.color.panelText}; ${typeCss('body')};
}
.loops-app { display: flex; flex-direction: column; gap: ${t.space.xs}px; padding-top: ${t.space.md}px; border-top: 1px solid ${t.color.panelLine}; }
.loops-app__row { display: flex; align-items: center; justify-content: space-between; gap: ${t.space.xl}px; }
.loops-app__name { ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; }
.home-card p.loops-app__note { ${typeCss('small')}; }
.home-card p.loops-app__note--warn { color: ${t.color.panelText}; }
.loops-held { margin-top: ${t.space.md}px; }
.loops-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.loops-row { display: flex; align-items: center; gap: ${t.space.xl}px; padding: ${t.space.lg}px 0; border-top: 1px solid ${t.color.panelLine}; }
.loops-row__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.loops-row__title { ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; overflow-wrap: anywhere; }
.loops-row__asks { ${typeCss('body')}; color: ${t.color.panelMuted}; overflow-wrap: anywhere; }
.loops-row__meta { display: flex; flex-wrap: wrap; ${typeCss('small')}; color: ${t.color.panelMuted}; }
.loops-row__meta > span + span::before { content: "·"; margin: 0 ${t.space.sm}px; }
.bodies-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.bodies-row { display: flex; align-items: center; gap: ${t.space.md}px; padding: ${t.space.md}px 0; border-top: 1px solid ${t.color.panelLine}; }
.bodies-row__name { flex: 1; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; }
.bodies-row__state { ${typeCss('small')}; color: ${t.color.panelMuted}; }
.bodies-wa { display: flex; flex-direction: column; gap: ${t.space.md}px; padding-top: ${t.space.lg}px; border-top: 1px solid ${t.color.panelLine}; }
.bodies-wa__head { display: flex; align-items: center; justify-content: space-between; gap: ${t.space.xl}px; }
.bodies-wa__title { display: flex; flex-direction: column; gap: ${t.space.xxs}px; min-width: 0; }
.bodies-wa__title .perm-group__title { margin: 0; }
.home-card p.bodies-wa__note { ${typeCss('small')}; }
.home-card p.bodies-wa__error { color: ${t.color.errInk}; font-weight: ${t.fontWeight.semibold}; }
.bodies-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: ${t.space.lg}px ${t.space.xl}px; }
.bodies-field { display: flex; flex-direction: column; gap: ${t.space.xs}px; min-width: 0; }
.bodies-field__top { display: flex; align-items: baseline; justify-content: space-between; gap: ${t.space.md}px; }
.bodies-field__top label { ${typeCss('body')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; }
.bodies-field__saved { ${typeCss('caption')}; color: ${t.color.okInk}; }
.bodies-field input {
  box-sizing: border-box; width: 100%; height: ${t.size.fieldHeight}px; padding: 0 ${t.space.lg}px;
  border: 1px solid var(--tg-ctl-line); border-radius: ${t.radius.field}px;
  background: var(--tg-ctl-bg); color: var(--tg-ctl-ink); font-family: ${t.font.ui}; ${typeCss('bodyLead')};
}
.bodies-field input::placeholder { color: ${t.color.panelMuted}; }
.bodies-field__hint { ${typeCss('small')}; color: ${t.color.panelMuted}; }
.bodies-form__foot { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: ${t.space.xl}px; }
.bodies-form__foot p { flex: 1; min-width: 0; }
.home-card p.bodies-wa__error { grid-column: 1 / -1; }
.loops-confirm { display: flex; align-items: center; flex-wrap: wrap; gap: ${t.space.md}px; }
.loops-confirm p { flex: 1 1 100%; color: ${t.color.panelText}; }
.job-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.job-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; column-gap: ${t.space.xl}px;
  padding: ${t.space.lg}px 0; border-top: 1px solid ${t.color.panelLine};
}
.job-row__main { min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xs}px; }
.job-row__task {
  ${typeCss('title')}; color: ${t.color.panelText};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.job-row__meta { display: flex; align-items: center; gap: ${t.space.md}px; min-width: 0; }
.job-row__where { min-width: 0; ${typeCss('body')}; color: ${t.color.panelMuted}; overflow-wrap: anywhere; }
.job-row__state {
  flex: none; padding: 1px ${t.space.md}px; border-radius: 999px; background: ${t.color.panelTile};
  ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText};
}
.job-row__state--running { background: ${t.color.warnFill}; color: ${t.color.warnInk}; }
.job-row__state--done { background: ${t.color.okFill}; color: ${t.color.okInk}; }
.job-row__state--error { background: ${t.color.errFill}; color: ${t.color.errInk}; }
.job-row__text { ${typeCss('body')}; color: ${t.color.panelMuted}; overflow-wrap: anywhere; }
.job-row__actions { display: flex; gap: ${t.space.lg}px; }
.job-row__result {
  grid-column: 1 / -1; margin: ${t.space.md}px 0 0; padding: ${t.space.md}px; overflow-wrap: anywhere;
  font: inherit; ${typeCss('body')}; color: ${t.color.panelText}; border: 1px solid ${t.color.panelLine}; border-radius: 8px;
}
.job-page__back {
  align-self: flex-start; margin: 0 0 ${t.space.xs}px; padding: 0; border: 0; background: none; cursor: pointer;
  font: inherit; ${typeCss('body')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.link};
}
.job-page__back::before { content: '\\2039' / ''; margin-right: ${t.space.sm}px; }
.job-page__back:hover { text-decoration: underline; }
.job-page__title { display: flex; align-items: center; flex-wrap: wrap; gap: ${t.space.md}px ${t.space.lg}px; }
.job-page__title .home-title { min-width: 0; overflow-wrap: anywhere; }
.job-page__title .tg-button { margin-left: auto; }
.job-page__time { ${typeCss('body')}; color: ${t.color.panelMuted}; font-variant-numeric: tabular-nums; }
.watch-list { margin-top: ${t.space.sm}px; }
.home-head .watch-list__caption { margin: 0 0 ${t.space.xs}px; ${typeCss('small')}; color: ${t.color.panelMuted}; }
.watch-list__items {
  list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${t.space.xs}px;
  /* About six lines; a longer list scrolls in its own box so it never squeezes the log. */
  max-height: 144px; overflow-y: auto;
}
.watch-list__item { display: flex; gap: ${t.space.md}px; ${typeCss('body')}; color: ${t.color.panelText}; overflow-wrap: anywhere; }
.watch-list__glyph { flex: none; width: 14px; text-align: center; color: ${t.color.panelMuted}; }
.watch-list__glyph--done { color: ${t.color.okInk}; }
.job-page__alert {
  margin: 0; padding: ${t.space.md}px ${t.space.lg}px; border-radius: ${t.radius.field}px;
  background: ${t.color.errFill}; color: ${t.color.errInk}; ${typeCss('body')};
}
.job-page__frame { position: relative; flex: 1 1 0; min-height: 232px; display: flex; flex-direction: column; }
.job-page__jump {
  position: absolute; left: 50%; bottom: ${t.space.lg}px; transform: translateX(-50%);
  min-height: 32px; padding: 0 ${t.space.xl}px; border: 0; border-radius: 999px; cursor: pointer;
  background: ${t.color.gold}; color: ${t.color.goldInk}; font: inherit; ${typeCss('body')}; font-weight: ${t.fontWeight.semibold};
}
/* The Now card: one row per live thing; a waiting ask is picked out with the warm fill. */
.now__row { display: flex; align-items: center; gap: ${t.space.xl}px; padding: ${t.space.lg}px 0; border-top: 1px solid ${t.color.panelLine}; }
.now__row:first-of-type { border-top: 0; }
.now__ask { padding: ${t.space.lg}px ${t.space.xl}px; border-radius: ${t.radius.field}px; background: ${t.color.warnFill}; color: ${t.color.warnInk}; }
.now__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.now__title { flex: 1; min-width: 0; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; overflow-wrap: anywhere; }
.now__meta { ${typeCss('small')}; color: ${t.color.panelMuted}; overflow-wrap: anywhere; }
.now__actions { display: flex; align-items: center; gap: ${t.space.lg}px; flex: none; }
/* The tab panel adds no box: a job page or a card stays a direct child of .home-page. */
.tasks-panel { display: contents; }
.job-tabs { display: flex; gap: ${t.space.xs}px; border-bottom: 1px solid ${t.color.panelLine}; }
.job-tabs__tab {
  margin: 0 0 -1px; padding: ${t.space.md}px ${t.space.xl}px; border: 0; border-bottom: 2px solid transparent; background: none;
  cursor: pointer; font: inherit; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelMuted};
}
.job-tabs__tab:hover { color: ${t.color.panelText}; }
.job-tabs__tab[aria-selected='true'] { color: ${t.color.panelText}; border-bottom-color: ${t.color.gold}; }
.job-tabs__tab:focus-visible, .job-report__head:focus-visible, .job-overview__link:focus-visible {
  outline: 2px solid ${t.color.link}; outline-offset: 2px; border-radius: ${t.radius.field}px;
}
.job-page__frame[hidden], .job-page__panel[hidden] { display: none; }
.job-page__panel { display: flex; flex-direction: column; gap: ${t.space.xl}px; min-width: 0; }
.job-overview { display: flex; flex-direction: column; gap: ${t.space.xxl}px; }
.job-overview__h { margin: 0 0 ${t.space.md}px; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; }
.job-overview__status { margin: 0; ${typeCss('bodyLead')}; color: ${t.color.panelMuted}; }
.job-overview__link {
  padding: 0; border: 0; background: none; cursor: pointer; font: inherit; color: ${t.color.link}; text-decoration: underline;
}
.job-overview__facts {
  margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: ${t.space.xl}px;
  padding-top: ${t.space.xl}px; border-top: 1px solid ${t.color.panelLine};
}
.job-overview__facts dt { ${typeCss('small')}; color: ${t.color.panelMuted}; }
.job-overview__facts dd { margin: ${t.space.xxs}px 0 0; ${typeCss('body')}; color: ${t.color.panelText}; font-variant-numeric: tabular-nums; }
.job-overview__who { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.job-reports { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.job-report { border-top: 1px solid ${t.color.panelLine}; }
.job-report__head {
  width: 100%; display: flex; align-items: center; flex-wrap: wrap; gap: ${t.space.md}px ${t.space.lg}px; padding: ${t.space.lg}px 0;
  border: 0; background: none; cursor: pointer; text-align: left; font: inherit; color: ${t.color.panelText};
}
.job-report__head::before { content: '\\203A' / ''; color: ${t.color.panelMuted}; transition: transform 120ms; }
.job-report__head[aria-expanded='true']::before { transform: rotate(90deg); }
@media (prefers-reduced-motion: reduce) { .job-report__head::before { transition: none; } }
.job-report__name { ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; overflow-wrap: anywhere; }
.job-report__when { margin-left: auto; ${typeCss('small')}; color: ${t.color.panelMuted}; }
.job-report__body { padding: 0 0 ${t.space.xl}px ${t.space.xxl}px; }
.job-report__note { margin: 0; ${typeCss('body')}; color: ${t.color.panelMuted}; }
.safe-md { ${typeCss('body')}; color: ${t.color.panelText}; overflow-wrap: anywhere; }
.safe-md > :first-child { margin-top: 0; }
.safe-md > :last-child { margin-bottom: 0; }
.safe-md h3, .safe-md h4, .safe-md h5, .safe-md h6 { margin: ${t.space.xl}px 0 ${t.space.sm}px; ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; }
.safe-md p, .safe-md ul, .safe-md ol, .safe-md pre, .safe-md blockquote { margin: 0 0 ${t.space.md}px; }
.safe-md ul, .safe-md ol { padding-left: ${t.space.xxl}px; }
.safe-md a { color: ${t.color.link}; }
.safe-md code { font-family: ${t.font.mono}; ${typeCss('small')}; background: ${t.color.panelTile}; padding: 0 ${t.space.xs}px; border-radius: 4px; }
.safe-md pre { overflow-x: auto; padding: ${t.space.md}px; background: ${t.color.panelTile}; border-radius: ${t.radius.field}px; }
.safe-md pre code { background: none; padding: 0; white-space: pre; }
.safe-md blockquote { padding-left: ${t.space.lg}px; border-left: 2px solid ${t.color.panelLine}; color: ${t.color.panelMuted}; }
.safe-md .safe-md__plain { white-space: pre-wrap; overflow-wrap: anywhere; }
.safe-md__table { overflow-x: auto; margin: 0 0 ${t.space.md}px; }
.safe-md table { border-collapse: collapse; ${typeCss('small')}; }
.safe-md th, .safe-md td { padding: ${t.space.xs}px ${t.space.md}px; border: 1px solid ${t.color.panelLine}; text-align: left; vertical-align: top; }
.safe-md th { background: ${t.color.panelTile}; color: ${t.color.panelMuted}; font-weight: ${t.fontWeight.semibold}; white-space: nowrap; }
.job-log__who { display: flex; align-items: center; gap: ${t.space.md}px; margin-top: ${t.space.lg}px; color: ${t.color.textMuted}; }
.job-log__who:first-child { margin-top: 0; }
.job-log__chip { padding: 0 ${t.space.md}px; border-radius: 999px; border: 1px solid ${t.color.line}; color: ${t.color.text}; font-weight: ${t.fontWeight.semibold}; }
.job-log {
  /* Fills what the page's head leaves (the frame is a flex item), whatever the head's height. */
  flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  padding: ${t.space.lg}px ${t.space.xl}px; border: 1px solid ${t.color.line}; border-radius: ${t.radius.row}px;
  background: ${t.color.page}; color: ${t.color.text};
  font-family: ${t.font.mono}; ${typeCss('small')};
}
.job-log__line { display: flex; gap: ${t.space.md}px; white-space: pre-wrap; overflow-wrap: anywhere; }
.job-log__cmd { margin-top: ${t.space.md}px; font-weight: ${t.fontWeight.semibold}; }
.job-log__meta { font-weight: 400; color: ${t.color.textMuted}; }
.job-log__exit { font-weight: 400; }
.job-log__exit--ok { color: ${t.ansi.green}; }
.job-log__exit--err { color: ${t.ansi.red}; }
.job-log__note { margin-left: ${t.space.xxl}px; color: ${t.color.textMuted}; }
.job-log__glyph { flex: none; width: 12px; text-align: center; font-weight: ${t.fontWeight.semibold}; }
.job-log__glyph--done { color: ${t.ansi.green}; }
.job-log__glyph--failed { color: ${t.ansi.red}; }
.job-log__glyph--pending { color: ${t.color.textMuted}; }
.job-log__glyph--stopped { color: ${t.color.textMuted}; }
.job-log__glyph--refused { color: ${t.ansi.red}; }
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
.apv-pref__sentence { ${typeCss('title')}; color: ${t.color.panelText}; overflow-wrap: anywhere; }
.apv-pref__meta { display: flex; flex-wrap: wrap; gap: ${t.space.xs}px ${t.space.xl - 2}px; ${typeCss('small')}; color: ${t.color.panelMuted}; }
.apv-pref__meta b { font-weight: ${t.fontWeight.semibold}; color: ${t.color.panelText}; }
.apv-pref__actions { flex: none; display: flex; gap: ${t.space.md}px; }
.apv-pref__edit.tg-panel { flex: 1; min-width: 0; padding: 0; background: transparent; }
.apv-pref__edit label { margin-bottom: ${t.space.md}px; }
.apv-summary { flex-direction: row; align-items: center; gap: ${t.space.xxl}px; padding: ${t.space.lg}px ${t.space.xl}px; }
.apv-summary div { display: flex; flex-direction: column; }
.apv-summary b { ${typeCss('heading')}; font-variant-numeric: tabular-nums; }
.apv-summary span { ${typeCss('small')}; color: ${t.color.panelMuted}; }
.apv-summary__sep { width: 1px; align-self: stretch; background: ${t.color.panelLine}; }
.apv-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: ${t.space.lg}px; }
.apv-seg { display: inline-flex; gap: ${t.space.xs}px; padding: 3px; border-radius: ${t.radius.row}px; background: ${t.color.panelTile}; }
.apv-seg button {
  height: 28px; padding: 0 ${t.space.lg}px; border: 0; border-radius: 7px; background: transparent;
  color: ${t.color.chipFreeInk}; font-family: ${t.font.ui}; ${typeCss('small')}; font-weight: ${t.fontWeight.semibold}; cursor: pointer;
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
.apv-row__time { white-space: nowrap; padding-top: ${t.space.xxs}px; ${typeCss('small')}; color: ${t.color.panelMuted}; font-variant-numeric: tabular-nums; }
.apv-row__icon { width: 16px; height: 16px; margin-top: ${t.space.xs}px; stroke: ${t.color.panelMuted}; fill: none; stroke-width: 1.6; }
.apv-row__body { min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.apv-row__what { ${typeCss('bodyLead')}; font-weight: ${t.fontWeight.semibold}; overflow-wrap: anywhere; }
.apv-row__source, .apv-row__by { ${typeCss('small')}; color: ${t.color.panelMuted}; }
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
  color: ${t.color.text}; ${typeCss('caption')};
}
.apv-more { align-self: flex-start; }
.home-controls { border-radius: 0; }
.home-controls * { box-sizing: border-box; }
`;
