---
name: Tagalong
description: Scout, one AI companion on your screen (Bean, a soft 3D figure, on the dock and still in Home), with Home as its calm control centre.
colors:
  shell-navy: '#12162B'
  shell-text: '#E9ECF5'
  shell-muted: '#A3AAC4'
  shell-line: '#262C4A'
  sidebar-navy: '#171C33'
  row-active: '#1E2442'
  avatar-tile: '#222845'
  field-navy: '#1A1F3A'
  field-line: '#2E3558'
  gold: '#F2C14E'
  gold-ink: '#12162B'
  sky: '#7CB8F2'
  soft-text: '#C9CEE0'
  done-green: '#7DD87F'
  paused-grey: '#6B7290'
  disabled-line: '#2A3050'
  quote-line: '#3A4270'
  navy-error-fill: '#3A1D2A'
  navy-error-ink: '#FFB4C0'
  panel-white: '#F6F7FB'
  card-white: '#FFFFFF'
  panel-text: '#12162B'
  panel-muted: '#5A6178'
  panel-line: '#E0E3EC'
  panel-tile: '#E6E9F2'
  chip: '#E6E9F2'
  chip-ink: '#4A5168'
  link: '#3D4A8A'
  ok-fill: '#E3F1E6'
  ok-ink: '#1F5A2E'
  warn-fill: '#FFF4D6'
  warn-ink: '#5C4600'
  err-fill: '#FDE7E5'
  err-ink: '#8A1C12'
  ready-green: '#2F9E44'
  scrollbar-thumb: '#CDD2DE'
typography:
  display:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '26px'
    lineHeight: '32px'
    fontWeight: 600
  heading:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '20px'
    lineHeight: '28px'
    fontWeight: 600
  title:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '16px'
    lineHeight: '22px'
    fontWeight: 600
  body-lead:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '14px'
    lineHeight: '21px'
    fontWeight: 400
  body:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '13px'
    lineHeight: '20px'
    fontWeight: 400
  small:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '12px'
    lineHeight: '16px'
    fontWeight: 400
  caption:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '11px'
    lineHeight: '14px'
    fontWeight: 600
  dock-tag:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '9px'
    lineHeight: '11px'
    fontWeight: 600
  mono:
    fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace"
    fontSize: '12px'
    fontWeight: 400
rounded:
  control-sm: '6px'
  field: '8px'
  row: '10px'
  tile: '10px'
  chip: '10px'
  card: '12px'
  pill: '999px'
spacing:
  xxs: '2px'
  hair: '3px'
  xs: '4px'
  sm: '6px'
  md: '8px'
  lg: '12px'
  xl: '16px'
  xxl: '20px'
  xxxl: '24px'
components:
  button-primary:
    backgroundColor: '{colors.gold}'
    textColor: '{colors.gold-ink}'
    typography: '{typography.title}'
    rounded: '{rounded.field}'
    padding: '0 16px'
    height: '40px'
  button-quiet:
    backgroundColor: 'transparent'
    textColor: '{colors.panel-text}'
    typography: '{typography.title}'
    rounded: '{rounded.field}'
    padding: '0 16px'
    height: '40px'
  field:
    backgroundColor: '{colors.panel-tile}'
    textColor: '{colors.panel-text}'
    rounded: '{rounded.field}'
    padding: '0 12px'
    height: '40px'
  chip:
    backgroundColor: '{colors.chip}'
    textColor: '{colors.chip-ink}'
    typography: '{typography.label-min}'
    rounded: '{rounded.chip}'
    padding: '2px 8px'
  chip-ok:
    backgroundColor: '{colors.ok-fill}'
    textColor: '{colors.ok-ink}'
    typography: '{typography.label-min}'
    rounded: '{rounded.chip}'
    padding: '2px 8px'
  chip-warn:
    backgroundColor: '{colors.warn-fill}'
    textColor: '{colors.warn-ink}'
    typography: '{typography.label-min}'
    rounded: '{rounded.chip}'
    padding: '2px 8px'
  chip-err:
    backgroundColor: '{colors.err-fill}'
    textColor: '{colors.err-ink}'
    typography: '{typography.label-min}'
    rounded: '{rounded.chip}'
    padding: '2px 8px'
  switch:
    backgroundColor: 'transparent'
    textColor: '{colors.panel-muted}'
    rounded: '{rounded.field}'
    padding: '0 12px'
    height: '32px'
  switch-on:
    backgroundColor: '{colors.gold}'
    textColor: '{colors.gold-ink}'
    rounded: '{rounded.field}'
    padding: '0 12px'
    height: '32px'
  dock-tag-seeing:
    backgroundColor: '{colors.sky}'
    textColor: '{colors.gold-ink}'
    typography: '{typography.dock-tag}'
    rounded: '{rounded.pill}'
    padding: '1px 3px'
  dock-tag-working:
    backgroundColor: '{colors.gold}'
    textColor: '{colors.gold-ink}'
    typography: '{typography.dock-tag}'
    rounded: '{rounded.pill}'
    padding: '1px 3px'
  dock-tag-done:
    backgroundColor: '{colors.done-green}'
    textColor: '{colors.gold-ink}'
    typography: '{typography.dock-tag}'
    rounded: '{rounded.pill}'
    padding: '1px 3px'
  dock-paused:
    backgroundColor: '{colors.paused-grey}'
    textColor: '{colors.shell-text}'
    typography: '{typography.label-min}'
    rounded: '{rounded.pill}'
    padding: '2px 6px'
  bubble:
    backgroundColor: '{colors.shell-navy}'
    textColor: '{colors.shell-text}'
    typography: '{typography.body-lead}'
    rounded: '{rounded.card}'
    padding: '14px 16px'
    width: '420px'
  bubble-primary:
    backgroundColor: '{colors.gold}'
    textColor: '{colors.gold-ink}'
    rounded: '{rounded.field}'
    padding: '0 16px'
    height: '36px'
  bubble-quiet:
    backgroundColor: 'transparent'
    textColor: '{colors.soft-text}'
    typography: '{typography.label}'
    rounded: '{rounded.control-sm}'
    padding: '0 10px'
    height: '28px'
  bubble-field:
    backgroundColor: '{colors.field-navy}'
    textColor: '{colors.shell-text}'
    rounded: '{rounded.field}'
    padding: '0 12px'
    height: '44px'
  bubble-chip:
    backgroundColor: '{colors.avatar-tile}'
    textColor: '{colors.soft-text}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    padding: '0 4px 0 10px'
    height: '28px'
  home-nav:
    backgroundColor: '{colors.sidebar-navy}'
    textColor: '{colors.shell-text}'
    width: '232px'
    padding: '20px 12px'
  home-nav-item:
    backgroundColor: 'transparent'
    textColor: '{colors.shell-muted}'
    rounded: '{rounded.field}'
    padding: '0 12px'
    height: '40px'
  home-nav-item-current:
    backgroundColor: '{colors.row-active}'
    textColor: '{colors.shell-text}'
    typography: '{typography.title}'
    rounded: '{rounded.field}'
    padding: '0 12px'
    height: '40px'
  home-card:
    backgroundColor: '{colors.card-white}'
    textColor: '{colors.panel-text}'
    rounded: '{rounded.card}'
    padding: '16px 20px'
  home-template:
    backgroundColor: '{colors.card-white}'
    textColor: '{colors.panel-text}'
    rounded: '{rounded.row}'
    padding: '12px 16px'
  home-day:
    backgroundColor: 'transparent'
    textColor: '{colors.panel-text}'
    typography: '{typography.label}'
    rounded: '{rounded.field}'
    padding: '0 8px'
    height: '32px'
  home-day-pressed:
    backgroundColor: '{colors.gold}'
    textColor: '{colors.gold-ink}'
    typography: '{typography.label}'
    rounded: '{rounded.field}'
    padding: '0 8px'
    height: '32px'
  setup-primary:
    backgroundColor: '{colors.gold}'
    textColor: '{colors.gold-ink}'
    rounded: '{rounded.field}'
    padding: '0 20px'
    height: '44px'
---

# Design System: Tagalong

## Overview

**Creative North Star: "A Clay Friend in Modern Chrome"**

Tagalong is one companion, Scout. On the desktop it is Bean, a soft clay-like 3D figure (round orange body, cream belly, pointed ears) drawn from pre-rendered WebP strips. Bean is the one figure everywhere: it moves on the dock and stands still (the first idle frame) beside Scout's line in Home's nav. It sits on the desktop and opens a speech bubble beside itself. The figure is the only game-like thing in the product; everything around it is calm, modern product chrome: a deep ink-navy for Scout's own surfaces (the dock tags, the bubble, Home's nav), a cool off-white for reading (Home's pages and Settings), clean Onest type and one warm gold.

Tokens live in `bodies/ui/src/theme/tokens.ts` (`themeTokens`). Most components read from it, but not all: the bubble, the cards inside it, the dock tags, Home's nav hard-code several hex values, recorded below as hard-coded. Scout is drawn from one WebP strip per mood (192px frames, 12 fps, in `bodies/desktop/src/renderer/src/bean/`) by `BeanClip`: stepped through with CSS `steps()` on the dock, held on frame 0 of the idle strip everywhere else. No canvas, no live 3D, no pixel sprites.

Scout's state is always a pose plus a word: Bean's clip changes per mood (with a floating sign for some: a thought cloud, glasses, a gear, z's, waves), a small tag says Seeing or Working for the states that last, and the accessible name says it in full. Motion is baked into the frames (a breath, typing, a page turn) and becomes a still frame for reduced motion.

**Key Characteristics:**

- One figure, Bean, everywhere (moving on the dock, still elsewhere); modern chrome around it.
- Navy for Scout's surfaces, off-white for reading.
- Gold for the primary action, an on state and Scout's active marks; sky blue for focus and fields inside the bubble.
- One typeface, Onest, in seven roles; rank comes from size and weight, never capitals.
- Bean outside the dock is always a still frame: 56px in Home's nav.
- Flat: tone and hairlines, no drop shadows.

## Colors

A cool ink-navy family and a cool off-white family, one warm gold, and a few signal colours (sky, green, red) that always travel with a word.

### Primary

- **Gold** (gold): the primary button fill (`Button` primary, `bubble-primary`), a switch that is on, a pressed day toggle, the pressed mic, the Working tag, the listening dot, the speaking bars, the hand-off working dot, text selection and the focus ring on navy surfaces only. Ink on gold is always **Gold Ink** (gold-ink).

### Secondary

- **Sky** (sky, `color.sky`): inside the bubble, the focus ring, the ask field's border, links in an answer, the "hearing" listening dot; also the Seeing tag, the "Your companion" line in Home's nav.
- **Done Green** (done-green, hard-coded): the listening mark on the dock (the dot while Always listening is on).

### Neutral

- **Ink Navy** (shell-navy, `color.page`): the bubble, the speech tail.
- **Sidebar Navy** (sidebar-navy): Home's nav, the full chat's header.
- **Active Row Navy** (row-active): the current page in Home's nav (hard-coded there as `#1E2442`).
- **Avatar Tile** (avatar-tile): the tile behind Scout in Home, bubble chips, your own messages in the chat, inline code, hover on bubble icon buttons (hard-coded as `#222845`).
- **Field Navy / Field Line** (field-navy, field-line): fields and code blocks on navy; the bubble border, the tail edge, quiet-button borders.
- **Shell Line** (shell-line): hairlines in the chat and the hand-off rows (hard-coded as `#262C4A`).
- **Frost Text / Shell Muted / Soft Text** (shell-text, shell-muted, soft-text): text on navy, strongest to softest. Soft Text (`#C9CEE0`) is hard-coded: quiet-button labels, chips, heard speech, the brief.
- **Paused Grey** (paused-grey, hard-coded): the dock's Paused chip.
- **Quote Line** (quote-line, hard-coded): answer blockquote rule.
- **Navy Error** (navy-error-fill, navy-error-ink, hard-coded): error messages in the bubble.
- **Panel White / Card White** (panel-white, card-white): Home's page ground and its cards (white is hard-coded `#fff`).
- **Panel Text / Panel Muted / Panel Line / Panel Tile** (panel-text, panel-muted, panel-line, panel-tile): text, secondary text, dividers and light fills on the light pages; Panel Tile is also the light field fill and the hover fill.
- **Link** (link): links and disclosure text on the light pages.
- **Status fills** (ok-, warn-, err- fill and ink; chip and chip-ink for neutral): status chips and alerts.
- **Ready Green** (ready-green, hard-coded): the Overview's 8px ready dot, gold when something needs you.
- **Scrollbar Thumb** (scrollbar-thumb): the 8px scrollbar in Settings.
- **ANSI palette** (`ansi` in tokens.ts): the 16 terminal colours of the job log, tuned for Page Navy: black `#6B7394`, red `#F28B82`, green `#8FD19E`, yellow `#F2C14E`, blue `#7CB8F2`, magenta `#C9A0F2`, cyan `#7FD6D9`, white `#C9CEDC`, and a brighter step of each (`#8A92B0`, `#FFADA6`, `#B1E5BC`, `#FFD97A`, `#A6D0F7`, `#DEC2F7`, `#A6E8EA`, `#FFFFFF`). Used only for command output; the job log's done and failed glyphs reuse its green and red.

### Named Rules

**The Gold Means Active Rule.** Gold marks the one primary action, a control that is on or pressed, or Scout doing something right now. It never decorates and never fills more than a button, a chip or a dot.

**The Two Grounds Rule.** Navy is Scout's own voice (dock, bubble, Home's nav); off-white is where you read and change things (Home's pages, Settings). A new surface picks one of the two.

## Typography

**Font:** Onest (with system-ui, sans-serif), set on `body` in the renderer sheet so no window falls back to the browser default. One face for every window and the browser add-on's popup and mic page.
**Mono:** ui-monospace, Cascadia Mono, Consolas (`font.mono`)

Every window bundles Onest 400 and 600 from `@fontsource` (Latin subset), nothing fetched; the browser add-on bundles the same two files into its popup and mic page. Weights are 400 and 600 only. Rank comes from size and weight; muted colour means "extra detail". No capitals, no letter spacing, no second typeface.

**Character:** One clean geometric sans. Scout's name and voice come from the words and Bean, not from a different face.

### Hierarchy

Seven roles in `themeTokens.type` (size/line in px, weight); `typeCss(role)` writes one into a style string.

| Role      | Size / line | Weight     | Used for                                                   |
| --------- | ----------- | ---------- | ---------------------------------------------------------- |
| display   | 26/32       | 600        | Walkthrough headlines, big figures (today's spend)         |
| heading   | 20/28       | 600        | Each Home page's title                                     |
| title     | 16/22       | 600        | Sub-headings, dialogs, the wordmark                        |
| body-lead | 14/21       | 400 or 600 | Bubble text, answers, button and nav labels, card headings |
| body      | 13/20       | 400        | Card text, previews, chat messages, help text              |
| small     | 12/16       | 400 or 600 | Meta lines, field labels, quiet bubble buttons             |
| caption   | 11/14       | 600        | Chips, status words, hints                                 |

- **Wordmark** ("Scout" in Home's nav, the walkthrough side and the chat header): title role, Onest 600. Class `tg-wordmark`, tokens `font.wordmark` and `fontWeight.wordmark`.
- **Dock tag** (Onest 600, 9px, 11px line, `themeTokens.dockTag`): Seeing and Working on the dock, small so they sit beside Bean's floating sign rather than on it. The one size outside the roles.
- **Mono** (12px): an expert's live steps in the hand-off card; inline code in answers is 12px.
- **Sentence case:** every label, card heading and button is sentence case ("Permissions", "Read my mail for loops"). Nothing is set in capitals.
- **Tabular numerals:** money and counts (spend card, daily limit, tab counts, times) use `font-variant-numeric: tabular-nums` so digits line up.

### Named Rules

**The Seven Roles Rule.** Every font size is one of the seven roles, or the 9px dock tag. `bodies/ui/src/type-audit.test.ts` reads every style sheet and fails on any other size, any weight other than 400 or 600, any capitals, any letter spacing and any pixel font.

**The 11px Floor Rule.** No functional text below 11px (`type.caption`). The one exception is the dock tags (9px, a user decision, 2026-10-17): at 11px they covered Bean's sign in the 96px window, and the accessible name says the state in full.

**The Focus Ring Rule.** Keyboard focus is a 2px ring: navy (`focusOnLight`) on light surfaces, gold (`focusOnNavy`) on navy ones only. Both come from the `--tg-focus` variable that `.on-navy` flips; no sheet sets a fixed gold focus ring.

## Layout

- **Dock:** the avatar window's button is 96px square, and so is one frame of Bean, with no padding. Bean stands about 55px tall at the bottom, its floating sign above; the tag sits in the top right corner, 4px down and flush right, the Paused chip 4px from the top and 12px from the left, the listening dot 8px up and 16px in from the bottom corner, and the status tag 18px up, centred.
- **Bubble:** a 420px-wide window (`PANEL_WIDTH`) that sizes its own height (80 to 520px; the full chat takes 520px). It has 10px of padding on the side the tail points to.
- **Home:** a 1440x800 window (min 880x600). A fixed 232px nav (20px by 12px padding) and a fluid main column (24px by 32px padding, 20px between blocks). Overview cards sit in an auto-fit grid (min 260px, 16px gap); routine templates in an auto-fill grid (min 220px, 8px gap). Embedded Settings sits in the same 920px page as every other tab.

Spacing runs on the token scale (2, 3, 4, 6, 8, 12, 16, 20, 24). The bubble and cards also use 14px, 28px and 32px, hard-coded. Controls are 40px tall in Home and Settings, 36px for the bubble's primary button, 44px for the bubble field, 28px for quiet bubble controls.

**The Still Bean Rule.** Outside the dock Bean is the idle strip's first frame, never animated, smoothly scaled: in Home's 56px nav tile it is drawn larger (76px) and cropped by the tile (`overflow: hidden`, nudged to centre), since Bean fills only about two thirds of a frame.

**The companion chat.** A 52 px header (Onest name, compact pills where on is a gold dot with a muted
gold edge, icon buttons for back and close). 24 px between turns, 12 px inside a turn. Your
messages sit on an avatar-tile bubble (12 px by 16 px inside), Scout's replies run full width, code
blocks have a 1 px field-line edge and 12 px inside, list markers are muted. Scout's mark (Bean's
still, 20 px, 48 px when the chat is empty) and name appear only on lines Scout starts. The footer
field has at least 12 px inside and a 2 px focus ring (navy on light, gold on navy). Anything bordered or filled that holds
text keeps at least 8 px inside, 12 to 16 px for cards and tiles; only keycaps and small pills are
tighter.

## Elevation & Depth

Flat. Depth is tonal: navy steps (page, sidebar, active row, tile) and hairlines (Shell Line and Field Line on navy, Panel Line on the light pages). The bubble is separated from the desktop by a 1px Field Line border, not a shadow.

### Shadow Vocabulary

**The No Lift Rule.** No drop shadows on the bubble, cards, buttons or the nav.

## Shapes

Gently rounded chrome. The bubble, Home cards use 12px; fields and primary buttons 8px; activity entries, templates, chips and Home's Scout tile 10px; quiet bubble buttons, icon buttons, key caps and error boxes 6px; dock tags and bubble chips are pills. 12px, 6px and the pill are hard-coded. The bubble's tail is a 14px square rotated 45 degrees with two bordered edges, 34px from the bottom, on the side Scout is on. Your own chat messages round three corners at 12px and the one nearest you at 4px. Icons are 14px stroked SVGs (1.6 stroke, currentColor).

## Components

### Scout on the dock (signature)

`DockPet` draws Bean, the 3D Scout, with `role="img"` and a full label ("Scout is looking at your screen, sight paused"). Each mood is its own pre-rendered clip from one fixed camera, so Bean never jumps between them: idle (a breath, a tail sway), listening (waves ripple out, ears perk), reading (glasses on, reading), thinking (a thought cloud), working (typing at a laptop, a gear turns) and dozing (rising z's). Bean's colours (in `bodies/desktop/scripts/bean/bean.py`): fur `#F39B5E`, belly `#FFF3E6`, ear tips `#5A3A2C`, cheeks `#F2A9A0`. Home's nav shows the idle clip's frame 0, still (see The Still Bean Rule). A tag sits top right: **Seeing** on Sky, **Working** on Gold (Scout's own job); thinking and reading have none, as they last seconds and the bubble is already answering; all in Gold Ink, Onest 600 9px. **Paused** is a Paused Grey pill top left, and while it shows the tag gives way (the two would overlap; the pose and the label still say the mood).

### The bubble

Ink Navy, 1px Field Line border, 12px radius, 14px by 16px padding, 12px gap, with the speech tail. States:

- **Ask:** chips for what Scout can see (Avatar Tile pills, Soft Text, each with a 24px round remove button), then the field: Field Navy, a 1px Sky border, 44px, 14px text, with a 12px Shell Muted label. Gold **primary** (36px, 8px radius, 600) and **quiet** buttons (28px, 6px radius, 1px Field Line border, Soft Text 12px). A 28px close button (Shell Muted, Avatar Tile on hover).
- **Answer:** Markdown at 14px/1.5, up to 260px then scrolling; code on Avatar Tile, code blocks on Field Navy, tables with Field Line borders, links in Sky (shown as text with the address on hover). Errors are a Navy Error box.
- **Full chat:** the bubble at full height with a Sidebar Navy header (Scout's name in Onest 600, 16px), a scrolling log (your messages right-aligned on Avatar Tile) and a footer with the field, both behind Shell Line hairlines.
- **Job line:** while an expert job runs, one 12px Soft Text line, `<expert>: <step title>`, truncated with an ellipsis, above the status row; no reserved space when absent, not announced to screen readers and never spoken.
- **Status marks:** neutral words, never Scout speaking. On Scout, a 1-2 word pill at the bottom centre, just above the corner dots (Onest 600 11px, 2px 7px, full radius; Warn Fill on Warn Ink for problems, `#6B7290` on Text for the rest), its sentence as the tooltip. In the bubble, a 12px `role="status"` row above the question box (`#F2D48A` for problems, Muted Text otherwise) with a quiet **Fix it** when there is a fix. No animation.
- **Dock listening dot (Always listening):** the 8px green dot at Scout's bottom right, solid while on, outlined while paused, a lighter green (`#B8F5B9`) quick pulse (0.6s, to 1.35x) while speech is heard, and a 2px green ring outside its white ring during the follow-up window. Its tooltip names the state. Reduced motion stops the pulse.
- **Listening and speaking:** a 28px mic button (Gold when on), heard speech in a Soft Text pill, an 8px pulsing dot (Gold while listening, Sky while hearing) and three 3px speaking bars in Gold driven by `--tg-voice-level`.

### Cards in the bubble

The connector confirm card shares the card CSS (`CARD_CSS`): a lead sentence, then a definition list of rows between Shell Line hairlines (12px Shell Muted labels in a 56px column; 13px values with 11px notes), a quiet button per row where a value can change, and one Gold primary plus quiet Cancel: **Allow once** for a connector change or a permission ask, with Always allow and Deny beside it. Long details scroll inside 160px and take keyboard focus.

### Home

- **Nav:** Sidebar Navy, 232px. Scout's 56px Avatar Tile tile (Bean, still, cropped to fill it) with the name and "Your companion" in Sky, then the six pages (Overview, Tasks, Connections, Approvals, What Scout remembers, Settings) as 40px buttons in Onest 14px Shell Muted; hover Frost Text; current (`aria-current="page"`) on Active Row Navy in 600.
- **Cards:** white, 1px Panel Line, 12px radius, 16px by 20px padding, a pixel card label, 13px Panel Muted text and a quiet button. The Overview card leads with a status dot and a word ("Ready"; with the brain down the dot turns warn and the word reads "Brain: Offline", "Brain: Connecting" or "Brain: Needs update", the same words as Where things run).
- **Page:** every tab sits in one `.home-page` box, 920px wide at most, centred, with one 32px inset (`space.page`), so the left edge never moves between tabs. Each page opens with a 20px title and one muted line (Overview: "Everything Scout is doing for you."). The nav carries `on-navy`, so shared controls take the gold focus ring there.
- **Jobs and Connections:** rows between Panel Line hairlines. A job row has the title (truncated, full text in `title`), a state chip and a no-wrap time on the left and its Watch, Stop or Show result button on the right. **Watch** opens the job page in place of the list (a quiet "Jobs" button above the title, named "Back to Jobs", goes back; focus moves to the title on Watch and returns to that Watch button): the title, the same state chip, the elapsed time and Stop, over a read-only log on Page Navy with a Line border and the 10px row radius, Mono 12px/1.55. `$ command` lines are 600 with a glyph (check in green, cross in red, a Gold spinner that stands still for reduced motion), output is Text Muted with the 16 ANSI colours tuned for the navy, edits are Sky, said lines start `# ` and are muted, the end line (`# done`, `# stopped`, `# error: ...`) is 600. A **Jump to latest** pill (Gold, 32px, pill) floats at the bottom when the person has scrolled up. A command with an exit code shows `exit N` after its text (400 weight, ANSI green for 0, red otherwise); with no code, only the glyph. Named Rule: a running command with no output says "output appears when the command finishes" rather than looking stuck. The Connections page has three groups below the app rows: Experts (a Panel Line row per installed expert with a state chip and one quiet Log in or Update button) and two Browse lists (apps, experts) of registry entries with a quiet Add button, which shows the stage and percent while it installs. A setup refusal or failure is one short line under the title, a muted note when nothing is wrong and an error line when it is. A connection row has an initial tile, the name, a status chip, the shared On/Off switch and its Sign in, Restart and Remove buttons.
- **Approvals and Memory:** preferences and history are white cards; times never wrap; each memory row has a kind chip, the fact (wraps inside the row), the date and a quiet Delete button.

### Walkthrough frame

1040x680: a navy side panel (`on-navy`: Scout, the nine steps, the footnote; the key step reads "Required" until a key is set, then "Key set") beside the off-white page. Each step opens with a small eyebrow (the step name, sentence case), a 26px Onest 600 headline and a lead; dense steps scroll inside the page with a thin scrollbar while the footer stays pinned. The footer is Back (outlined, left, hidden on step 1), a quiet Skip text link and the gold primary button ("Get started", "Next", "Finish") with an arrow. Steps 1 to 4 use white cards with a 1px line and 12 to 16px radius, a day strip with gold timeline dots, a CSS-arrow flow, keycaps for shortcuts and a static navy bubble preview. Steps 5 to 9 reuse the shared controls (selects, switch, slider, money stepper, key field) in a two-column form, a quiet "Spent today" line under the daily limit (muted small text, `tg-spent`), a navy hand-off or approval preview card (`wt-handoff`, an illustration, `aria-hidden`), a white card of four checked key notes, and a finish screen of keycap rows (Ask, Talk) beside three things to try, ending in Open Home and Done.

### Settings controls

Scoped under `.tg-settings`. **Save** is the shared primary `Button`, once, at the top right beside the page heading; the status line sits under it. **Quiet** (`tg-btn-quiet`): transparent with a 1px border (Panel Muted on light pages, Field Line on navy). **Fields:** Control Fill (white) in the shared controls, Panel Tile fill in Settings, 1px Panel Line border, 8px, 40px, 14px; invalid gets a 2px Err Ink border. **Chips:** 11px 600 pills at 10px radius, neutral, ok, warn or err, always with a word. **Switches** are the shared `Toggle`; Voice's pickers and speed are the shared `Select` and `Slider`, each carried into Save by a hidden field of the same name. Shortcuts show as keycaps above their accelerator field. **Choices:** 2px Panel Line border, Gold when checked. Embedded in Home, each section is a white card with a 12px radius and 20px by 24px padding, the same box as every Home card. Alerts use the warn and err fills; ⓘ buttons are 24px round.

### Shared controls

Live in `bodies/ui/src/controls/` and are styled by `CONTROLS_CSS`, injected next to each host sheet. A control learns its surface from CSS variables, not props: `:root` is the light page, `.on-navy` the navy chrome (`--tg-focus`, `--tg-ctl-*`).

- **Focus ring:** 2px, offset 2px; navy (`focusOnLight`) on light surfaces, Gold (`focusOnNavy`) under `.on-navy`. Hover and disabled states are real on every control.
- **Toggle** (`Toggle`): `role="switch"` with `aria-checked`, a 44x24 pill with the word On or Off and a round knob; on is Gold. A native button, so Space and Enter work.
- **Three-way** (`ThreeWay`): a segmented pill for two or three words (Off, Ask, Auto), a `radiogroup` of native buttons with `aria-checked` and one roving tab stop (the chosen option, else the first enabled one); arrows move to the next enabled option and wrap. Options are 24px tall (30px with the pill), the chosen one is Gold with Gold Ink, a disabled one is at 0.4 opacity. The group is named by visible text (`labelledBy`) when it has some.
- **Select** (`Select`): a native select with a drawn chevron and its label above; 36px.
- **Slider** (`Slider`): a native range (arrows, Home and End work) with the label above and the value beside it.
- **Money field** (`MoneyField`): a `$` text field with minus and plus buttons (step 1, never below 0); typed text is not clamped, the caller validates; Enter commits.
- **Keycap and Shortcut:** one `kbd` per key; an Electron accelerator is shown as Ctrl, Shift, Space, never `CommandOrControl`.
- **Level meter** (`LevelMeter`, with `MicTest`): a read-only `role="meter"` bar, 10px high, 1px control line, filled in the control ink and Gold at the loud end (80% and up); shown only while the "Test your microphone" button is on, with a small muted line that nothing is recorded or sent and an Err Ink line when the microphone cannot open.
- **Button** (`Button`): primary (Gold), secondary, quiet and danger; type=button by default.
- **Key field** (`KeyField`): label above; Show sits inside the input on the right, Check key (secondary) beside it, a polite status line under it. States: empty, checking, valid (ok border) and invalid (2px Err Ink border, `aria-invalid`).

## Motion

- **Dock:** the motion is in Bean's frames, 12 fps, stepped with CSS `steps()`: loops of 2 to 4 seconds. Blinks are a 2-frame clip (about 170ms) every 3 to 6 seconds in idle and listening only, started when the loop comes back to frame 0, the pose the blink was rendered from.
- **Bubble:** the invitation enters over 220ms (fade and 4px rise, ease-out). The invitation types at 22ms a character. The listening dot pulses (1.2s, to 35% opacity); speaking bars follow the voice level with a 90ms linear transition.

Under `prefers-reduced-motion: reduce`: Bean shows one still frame per mood (frame 0 of a loop) and does not blink, the bubble appears and leaves without moving, the dot stops pulsing, the bars hold at 60%, and the invitation appears whole.

## Accessibility

- **Reduced motion** is honoured everywhere above.
- **Status is never colour alone:** dock tags are words, the Paused chip says Paused, chips carry words, the Overview dot sits beside "Ready".
- **Focus rings:** 2px at 2px offset, from `--tg-focus`: navy on Home's and Settings' light pages, Gold under `.on-navy`, and Sky in the bubble.
- **The figure:** `BeanClip` is `aria-hidden`; on the dock the wrapper is `role="img"` with Scout's name and state. The invitation is announced whole through a hidden status line while the visible text types; the bubble's status row is `role="status"`. The chat log is `role="log"`; errors are `role="alert"`; expert steps are `aria-live="polite"`.

## Do's and Don'ts

### Do:

- **Do** take colours, sizes, spacing and radii from `themeTokens`; add a token before adding another hard-coded value.
- **Do** draw Scout as Bean through `BeanClip`: moving on the dock, still (`still`, sized with `size`) everywhere else.
- **Do** keep gold for the one primary action, an on or pressed control, and Scout's active marks.
- **Do** pair every status with a word (and an icon where there is room).
- **Do** set every size on one of the seven type roles, in sentence case, with tabular numerals for money and counts.
- **Do** stop every animation under `prefers-reduced-motion`.
- **Do** build new bubble cards from `HANDOFF_CSS`: a lead sentence, labelled rows, one Gold primary and a quiet Cancel.

### Don't:

- **Don't** draw Scout any other way than Bean's strips.
- **Don't** use gold for decoration or fills larger than a button.
- **Don't** signal state by colour alone.
- **Don't** use capitals, letter spacing, a second typeface or any text below 11px (the dock tag aside).
- **Don't** add drop shadows; separate with tone and hairlines.
