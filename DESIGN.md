---
name: Tagalong
description: Scout, one AI companion on your screen (Bean, a soft 3D figure, on the dock and still in Welcome and Home), with Home as its calm control centre.
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
  recording-red: '#E5484D'
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
  welcome-title:
    fontFamily: "'Pixelify Sans', 'Onest', sans-serif"
    fontSize: '28px'
    fontWeight: 700
    letterSpacing: '0.5px'
  page-title:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '20px'
    fontWeight: 600
  companion-name:
    fontFamily: "'Pixelify Sans', 'Onest', sans-serif"
    fontSize: '18px'
    fontWeight: 700
    letterSpacing: '0.5px'
  panel-heading-pixel:
    fontFamily: "'Pixelify Sans', 'Onest', sans-serif"
    fontSize: '15px'
    fontWeight: 600
    letterSpacing: '1px'
  card-label:
    fontFamily: "'Pixelify Sans', 'Onest', sans-serif"
    fontSize: '12px'
    fontWeight: 400
    letterSpacing: '1px'
  subhead:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '15px'
    fontWeight: 600
  title:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '14px'
    fontWeight: 600
  body-lead:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '13px'
    fontWeight: 400
  label:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '12px'
    fontWeight: 400
  dock-tag:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '9px'
    lineHeight: '11px'
    fontWeight: 600
  label-min:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '11px'
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
  home-entry:
    backgroundColor: 'transparent'
    textColor: '{colors.panel-text}'
    rounded: '{rounded.row}'
    padding: '8px'
  home-entry-open:
    backgroundColor: '{colors.panel-tile}'
    textColor: '{colors.panel-text}'
    rounded: '{rounded.row}'
    padding: '8px'
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

Tagalong is one companion, Scout. On the desktop it is Bean, a soft clay-like 3D figure (round orange body, cream belly, pointed ears) drawn from pre-rendered WebP strips. Bean is the one figure everywhere: it moves on the dock and stands still (the first idle frame) beside Scout's line in Welcome, in Home's nav and on each Activity entry. It sits on the desktop and opens a speech bubble beside itself. The figure is the only game-like thing in the product; everything around it is calm, modern product chrome: a deep ink-navy for Scout's own surfaces (the dock tags, the bubble, Welcome, Home's nav), a cool off-white for reading (Home's pages and Settings), clean Onest type and one warm gold.

Tokens live in `packages/ui/src/theme/tokens.ts` (`themeTokens`). Most components read from it, but not all: the bubble, the cards inside it, the dock tags, Home's nav and Welcome hard-code several hex values, recorded below as hard-coded. Scout is drawn from one WebP strip per mood (192px frames, 12 fps, in `apps/desktop/src/renderer/src/bean/`) by `BeanClip`: stepped through with CSS `steps()` on the dock, held on frame 0 of the idle strip everywhere else. No canvas, no live 3D, no pixel sprites.

Scout's state is always a pose plus a word: Bean's clip changes per mood (with a floating sign for some: a thought cloud, glasses, a badge, a gear, a check mark, z's), a small tag says Seeing, Working or Done for the states that last, and the accessible name says it in full. Motion is baked into the frames (a breath, typing, a hop) and becomes a still frame for reduced motion.

**Key Characteristics:**

- One figure, Bean, everywhere (moving on the dock, still elsewhere); modern chrome around it.
- Navy for Scout's surfaces, off-white for reading.
- Gold for the primary action, an on state and Scout's active marks; sky blue for focus and fields inside the bubble.
- Pixel type for names, titles and short uppercase labels; Onest for every sentence and control.
- Bean outside the dock is always a still frame: 96px in Welcome, 56px in Home's nav, 32px on Activity entries.
- Flat: tone and hairlines, no drop shadows.

## Colors

A cool ink-navy family and a cool off-white family, one warm gold, and a few signal colours (sky, green, red) that always travel with a word.

### Primary

- **Gold** (gold): the primary button fill (`tg-btn`, `bubble-primary`, Welcome's Check key), a switch that is on, a pressed day toggle, the pressed mic, the Working tag, the listening dot, the speaking bars, Welcome's current step chip and its 2px suggestion outline, the hand-off working dot, text selection and the focus ring in Settings, Home and Welcome. Ink on gold is always **Gold Ink** (gold-ink).

### Secondary

- **Sky** (sky, hard-coded): inside the bubble, the focus ring, the ask field's border, links in an answer, the "hearing" listening dot; also the Seeing tag, the "Your companion" line in Home's nav and Welcome's link buttons.
- **Done Green** (done-green, hard-coded): the Done tag on the dock and a found agent's dot in Welcome.
- **Recording Red** (recording-red, hard-coded): the 8px rolling-memory dot on the dock, with a 1px white ring, and the 8px listening dot in Welcome's header while setup's mic is open.

### Neutral

- **Ink Navy** (shell-navy, `color.page`): the bubble, the speech tail, Welcome, the standalone Settings bar.
- **Sidebar Navy** (sidebar-navy): Home's nav, the full chat's header.
- **Active Row Navy** (row-active): the current page in Home's nav (hard-coded there as `#1E2442`).
- **Avatar Tile** (avatar-tile): the tile behind Scout in Home and Welcome, bubble chips, your own messages in the chat, inline code, hover on bubble icon buttons (hard-coded as `#222845`).
- **Field Navy / Field Line** (field-navy, field-line): fields and code blocks on navy; the bubble border, the tail edge, quiet-button borders.
- **Shell Line** (shell-line): hairlines in the chat and the hand-off rows (hard-coded as `#262C4A`).
- **Frost Text / Shell Muted / Soft Text** (shell-text, shell-muted, soft-text): text on navy, strongest to softest. Soft Text (`#C9CEE0`) is hard-coded: quiet-button labels, chips, heard speech, the brief.
- **Paused Grey** (paused-grey, hard-coded): the dock's Paused chip and Welcome's disabled label and the step chips still ahead. **Disabled Line** (disabled-line): Welcome's disabled Check key fill.
- **Quote Line** (quote-line, hard-coded): answer blockquote rule; Welcome key-cap border.
- **Navy Error** (navy-error-fill, navy-error-ink, hard-coded): error messages in the bubble and Welcome.
- **Panel White / Card White** (panel-white, card-white): Home's page ground and its cards (white is hard-coded `#fff`).
- **Panel Text / Panel Muted / Panel Line / Panel Tile** (panel-text, panel-muted, panel-line, panel-tile): text, secondary text, dividers and light fills on the light pages; Panel Tile is also the light field fill and the hover fill.
- **Link** (link): links and disclosure text on the light pages.
- **Status fills** (ok-, warn-, err- fill and ink; chip and chip-ink for neutral): status chips and alerts.
- **Ready Green** (ready-green, hard-coded): the Overview's 8px ready dot, gold when something needs you.
- **Scrollbar Thumb** (scrollbar-thumb): the 8px scrollbar in Settings.

### Named Rules

**The Gold Means Active Rule.** Gold marks the one primary action, a control that is on or pressed, or Scout doing something right now. It never decorates and never fills more than a button, a chip or a dot.

**The Two Grounds Rule.** Navy is Scout's own voice (dock, bubble, Welcome, Home's nav); off-white is where you read and change things (Home's pages, Settings). A new surface picks one of the two.

## Typography

**Display Font:** Pixelify Sans (with Onest, sans-serif)
**Body Font:** Onest (with system-ui, sans-serif)
**Mono:** ui-monospace, Cascadia Mono, Consolas

Every window bundles its faces from `@fontsource` (Latin subset), nothing fetched: Home and the standalone Settings window Onest 400/600 and Pixelify Sans 400/600/700; Welcome Onest 400/600 and Pixelify Sans 400/700; the bubble Onest 400/600 and Pixelify Sans 700; the dock Onest 600 for its tags.

**Character:** A chunky pixel face gives Scout a name and a voice; a clean geometric sans keeps every sentence and control modern.

### Hierarchy

- **Welcome title** (Pixelify 700, 28px, 0.5px): the question of the step on screen ("What should I call you?") in Welcome.
- **Page title** (Onest 600, 20px): each Home page's heading.
- **Companion name** (Pixelify 700, 18px, 0.5px): Scout's name in Home's nav; the chat header uses the same face at 16px.
- **Panel heading, pixel** (Pixelify 600, 15px, 1px, uppercase): Settings section headings.
- **Card label** (Pixelify 400, 12px, 1px, uppercase): Home card headings ("EXPERTS", "RECENT") (Welcome has none: its option cards carry their own labels).
- **Subhead** (Onest 600, 15px): Settings sub-headings, alert titles.
- **Title** (Onest 600, 14px): buttons, nav items, Activity headlines, template names.
- **Body lead** (Onest 400, 14px, 1.5): bubble text, answers, Home notes.
- **Body** (Onest 400, 13px): card text, previews, the chat's messages, help text (1.55).
- **Label** (Onest 400, 12px): meta lines, field labels, quiet bubble buttons, bubble chips.
- **Label min** (Onest 600, 11px): chips, the dock's Paused chip, bubble hints.
- **Dock tag** (Onest 600, 9px, 11px line): Seeing, Working and Done on the dock, small so they sit beside Bean's floating sign rather than on it.
- **Mono** (12px): an expert's live steps in the hand-off card; inline code in answers is 12.5px.

### Named Rules

**The Pixel Is A Name Rule.** Pixelify Sans sets names, titles and short uppercase headings only. Sentences, controls, fields, statuses and numbers are Onest.

**The 11px Floor Rule.** No functional text below 11px (`fontSize.min`). The one exception is the dock tags (9px, a user decision, 2026-10-17): at 11px they covered Bean's sign in the 96px window, and the accessible name says the state in full.

## Layout

- **Dock:** the avatar window's button is 96px square, and so is one frame of Bean, with no padding. Bean stands about 55px tall at the bottom, its floating sign above; the tag sits in the top right corner, 4px down and flush right, the Paused chip 4px from the top and 12px from the left, the recording and listening dots 8px up and 16px in from the bottom corners, and the status tag 18px up, centred.
- **Bubble:** a 420px-wide window (`PANEL_WIDTH`) that sizes its own height (80 to 520px; the full chat takes 520px). It has 10px of padding on the side the tail points to.
- **Home:** a 1440x800 window (min 880x600). A fixed 232px nav (20px by 12px padding) and a fluid main column (24px by 32px padding, 20px between blocks). Overview cards sit in an auto-fit grid (min 260px, 16px gap); routine templates in an auto-fill grid (min 220px, 8px gap). Embedded Settings sits in the main column, max 820px.
- **Welcome:** a 900x620 window in two columns. A header of step chips (18px by 32px padding, 8px apart), then a 300px left column for Scout and its words and a right column for the question, 40px apart, 40px by 48px padding. The answer pill is pinned to the bottom of the right column.
- **Standalone Settings:** 1080x760, opened only when Tagalong starts without its engine; a 64px bar over a 280px nav (`size.headerHeight`, `size.navWidth`).

Spacing runs on the token scale (2, 3, 4, 6, 8, 12, 16, 20, 24). The bubble and cards also use 14px, 28px and 32px, hard-coded. Controls are 40px tall in Home and Settings, 36px for the bubble's primary button, 44px for the bubble field and Welcome's key field and Check key, 46px for Welcome's answer pill, 28px for quiet bubble controls.

**The Still Bean Rule.** Outside the dock Bean is the idle strip's first frame, never animated, smoothly scaled: 96px uncropped in Welcome; in Home's 56px nav tile and Activity's 32px tile it is drawn larger (76px and 44px) and cropped by the tile (`overflow: hidden`, nudged to centre), since Bean fills only about two thirds of a frame.

## Elevation & Depth

Flat. Depth is tonal: navy steps (page, sidebar, active row, tile) and hairlines (Shell Line and Field Line on navy, Panel Line on the light pages). The bubble is separated from the desktop by a 1px Field Line border, not a shadow.

### Shadow Vocabulary

- **Recording ring** (`box-shadow: 0 0 0 1px #fff`): the white ring around the recording dot.

**The No Lift Rule.** No drop shadows on the bubble, cards, buttons or the nav.

## Shapes

Gently rounded chrome, square pixels. The bubble, Home cards and Welcome's tile use 12px; fields and primary buttons 8px; activity entries, templates, chips and Home's Scout tile 10px; quiet bubble buttons, icon buttons, key caps and error boxes 6px; dock tags and bubble chips are pills. 12px, 6px and the pill are hard-coded. The bubble's tail is a 14px square rotated 45 degrees with two bordered edges, 34px from the bottom, on the side Scout is on. Your own chat messages round three corners at 12px and the one nearest you at 4px. Icons are 14px stroked SVGs (1.6 stroke, currentColor).

## Components

### Scout on the dock (signature)

`DockPet` draws Bean, the 3D Scout, with `role="img"` and a full label ("Scout is looking at your screen, sight paused"). Each mood is its own pre-rendered clip from one fixed camera, so Bean never jumps between them: idle (a breath, a tail sway), listening (waves ripple out, ears perk), reading (glasses on, reading), thinking (a thought cloud), expert (a walkie-talkie, a badge at the top left), working (typing at a laptop, a gear turns), done (a hop, a check mark), dozing (rising z's), wince (a shake, a sweat drop), cheer (one hop) and tired (a drooping head). Bean's colours (in `apps/desktop/scripts/bean/bean.py`): fur `#F39B5E`, belly `#FFF3E6`, ear tips `#5A3A2C`, cheeks `#F2A9A0`. Welcome, Home's nav and Activity show the idle clip's frame 0, still (see The Still Bean Rule). A tag sits top right: **Seeing** on Sky, **Working** on Gold (for expert and for working, Scout's own job), **Done** on Done Green; thinking and reading have none, as they last seconds and the bubble is already answering; all in Gold Ink, Onest 600 9px. **Paused** is a Paused Grey pill top left, and while it shows the tag gives way (the two would overlap; the pose and the label still say the mood; in the expert pose it covers the badge, and the walkie-talkie still shows); the Recording Red dot sits bottom left while rolling memory is on and sight is not paused.

### The bubble

Ink Navy, 1px Field Line border, 12px radius, 14px by 16px padding, 12px gap, with the speech tail. States:

- **Ask:** chips for what Scout can see (Avatar Tile pills, Soft Text, each with a 24px round remove button), then the field: Field Navy, a 1px Sky border, 44px, 14px text, with a 12px Shell Muted label. Gold **primary** (36px, 8px radius, 600) and **quiet** buttons (28px, 6px radius, 1px Field Line border, Soft Text 12px). A 28px close button (Shell Muted, Avatar Tile on hover).
- **Answer:** Markdown at 14px/1.5, up to 260px then scrolling; code on Avatar Tile, code blocks on Field Navy, tables with Field Line borders, links in Sky (shown as text with the address on hover). Errors are a Navy Error box.
- **Full chat:** the bubble at full height with a Sidebar Navy header (Scout's name in Pixelify 16px), a scrolling log (your messages right-aligned on Avatar Tile) and a footer with the field, both behind Shell Line hairlines.
- **Invitation:** one line typed in at 22ms a character, held at full height so the bubble does not grow, with Try it now and Got it (no Next, no step dots).
- **Launch line:** one short line in a compact bubble (10px 8px 10px 14px padding) that fades out over 300ms. When Scout cannot think it shows the status row instead of words, with **Fix it**.
- **Status marks:** neutral words, never Scout speaking. On Scout, a 1-2 word pill at the bottom centre, just above the corner dots (Onest 600 11px, 2px 7px, full radius; Warn Fill on Warn Ink for problems, `#6B7290` on Text for the rest), its sentence as the tooltip. In the bubble, a 12px `role="status"` row above the question box (`#F2D48A` for problems, Muted Text otherwise) with a quiet **Fix it** when there is a fix. No animation.
- **Dock listening dot (Always listening):** the 8px green dot at Scout's bottom right, solid while on, outlined while paused, a lighter green (`#B8F5B9`) quick pulse (0.6s, to 1.35x) while speech is heard, and a 2px green ring outside its white ring during the follow-up window. Its tooltip names the state. Reduced motion stops the pulse.
- **Listening and speaking:** a 28px mic button (Gold when on), heard speech in a Soft Text pill, an 8px pulsing dot (Gold while listening, Sky while hearing) and three 3px speaking bars in Gold driven by `--tg-voice-level`.

### Cards in the bubble

The hand-off card, connector confirm card and routine card share `HANDOFF_CSS`: a lead sentence, then a definition list of rows between Shell Line hairlines (12px Shell Muted labels in a 56px column, 72px for the routine card; 13px values with 11px notes), a quiet button per row where a value can change, and one Gold primary plus quiet Cancel: **Send** for a hand-off, **Allow once** for a connector change, **Save** (or Pause, Turn on, Delete) for a routine. While an expert works, a Gold dot leads "Claude Code is on it" and its steps list in mono, the newest in Frost Text. Long details scroll inside 160px and take keyboard focus.

### Home

- **Nav:** Sidebar Navy, 232px. Scout's 56px Avatar Tile tile (Bean, still, cropped to fill it) with the name and "Your companion" in Sky, then the eight pages (Overview, Scout, Experts, Routines, Connections, Activity, What Scout saw, Settings) as 40px buttons in Onest 14px Shell Muted; hover Frost Text; current (`aria-current="page"`) on Active Row Navy in 600.
- **Cards:** white, 1px Panel Line, 12px radius, 16px by 20px padding, a pixel card label, 13px Panel Muted text and a quiet button. The Overview card leads with a status dot and a word ("Ready").
- **Activity:** entries are full-width buttons (`aria-expanded`), 10px radius, 8px padding: Bean, still, in a 32px tile, an Onest 600 14px headline, a 12px meta line (a 14px state icon, the state word, tool, model, calls, time) and a 13px one-line preview. Hover and open fill Panel Tile; the open thread is indented behind a 2px Panel Line rule. "Show older" is a 40px quiet button.
- **What Scout saw:** a header (the 20px title, a 13px Panel Muted retention line, and a quiet **Delete all** that turns into **Delete all for good** / **Keep them**), then Today, Yesterday and Earlier as 12px uppercase Panel Muted labels. Each row, 10px radius, 8px padding, Panel Tile on hover: a 12px tabular time, a 16px line icon per kind in Panel Muted, the kind in Onest 600 14px, the app and window or the destination in 13px (one line, ellipsis), the counts in 12px Panel Muted, and a 28px quiet × at the end.
- **Routines:** template tiles (white, 2px Panel Line border, 10px radius, Panel Tile on hover) and day toggles (32px, min 52px, 1px Panel Muted border; Gold when pressed).
- **Experts and Connections:** rows between Panel Line hairlines with status chips and switches.

### Settings controls

Scoped under `.tg-settings`. **Primary** (`tg-btn`): Gold, 40px, 8px, Onest 600 14px, 16px padding. **Quiet** (`tg-btn-quiet`): transparent with a 1px border (Panel Muted on light pages, Field Line on navy). **Fields:** Panel Tile fill, 1px Panel Line border, 8px, 40px, 14px; invalid gets a 2px Err Ink border. **Chips:** 11px 600 pills at 10px radius, neutral, ok, warn or err, always with a word. **Switches** (`role="switch"`): 32px, min 64px, Panel Muted outline; on is Gold. **Choices:** 2px Panel Line border, Gold when checked. Embedded in Home, each section is a white card with a 12px radius and 24px by 28px padding. Alerts use the warn and err fills; ⓘ buttons are 24px round.

### Welcome

Setup, Scout's own voice on Ink Navy, 900x620, with no Next button: Scout asks and moves on by itself. **Header:** a row of step chips (30px pills, Onest 600 13px). A step you answered is a button in Done Green on Avatar Tile with a Field Line border and reads your answer ("You: Alex"); the step you are on has a 1px Gold outline and Gold text; steps ahead are Paused Grey with no border. **Left column:** the echo of your last answer above, a small Avatar Tile pill in Done Green (10px radius); below it Scout's speech bubble in Panel White (14px radius, with the 4px bottom-left corner as the tail), Ink Navy text, Onest 16px; then Scout at scale 6. **Right column:** the Welcome title, then option cards in a stack, 10px apart: Field Navy, 1px Field Line, 12px radius, 16px padding, label Onest 600 15px with a Soft Text note under it. The suggestion has a 2px Gold border and a Done Green note; a pressed service has a Soft Text border. The key caps for the ask key are Avatar Tile with a 3px bottom border. A pasted key has a 44px Field Navy field and a Gold Check key button (`setup-primary`). **Answer pill:** 46px, full-round, Field Navy with a 1px Field Line border, the Gold ring round the whole pill when it has focus, with a 12px Soft Text hint beneath ("Answer by typing or a tap and I move on…", or "Answer by voice, typing or a tap…" once you chose to talk). **Listening:** right of the chips, Soft Text Onest 13px: while the speech model downloads, only the words ("Getting my ears ready… 40%. Type or tap meanwhile."); while the mic is open, an 8px Recording Red dot pulsing to 35% opacity over 1.2s, 8px before "Listening for your answer". It is a `role="status"` line, and the dot is never the only sign. **Always listening** on the keys step is a Field Navy row (1px Field Line, 12px radius, 16px padding) with its label and the Soft Text note "Off by default. I never switch it on myself.", and a `role="switch"` on the right: 32px, min 64px, 8px radius, a Field Line outline and Soft Text "Off"; Gold with Gold Ink "On" when on. Problems with the window show in Navy Error; a key problem is said only in Scout's bubble.

## Motion

- **Dock:** the motion is in Bean's frames, 12 fps, stepped with CSS `steps()`: loops of 2 to 4 seconds, and cheer and wince play once (1s) and hold their last frame. Blinks are a 2-frame clip (about 170ms) every 3 to 6 seconds in idle and listening only, started when the loop comes back to frame 0, the pose the blink was rendered from.
- **Bubble:** the invitation and launch line enter over 220ms (fade and 4px rise, ease-out); the launch line leaves over 300ms (fade and 4px drop). The invitation types at 22ms a character. The listening dot pulses (1.2s, to 35% opacity); speaking bars follow the voice level with a 90ms linear transition.

Under `prefers-reduced-motion: reduce`: Bean shows one still frame per mood (frame 0 of a loop, the held last frame of cheer and wince) and does not blink, the bubble appears and leaves without moving, the dot stops pulsing (Welcome's listening dot too), the bars hold at 60%, and the invitation appears whole.

## Accessibility

- **Reduced motion** is honoured everywhere above.
- **Status is never colour alone:** dock tags are words, the Paused chip says Paused, the recording dot has a title and is in Scout's label, Activity states are an icon plus a word, chips carry words, the Overview dot sits beside "Ready".
- **Focus rings:** 2px at 2px offset, Gold in Settings (`.tg-settings :focus-visible`), Home (`.home :focus-visible`) and Welcome (`.welcome :focus-visible`), and Sky in the bubble.
- **The figure:** `BeanClip` is `aria-hidden`; on the dock the wrapper is `role="img"` with Scout's name and state. The invitation is announced whole through a hidden status line while the visible text types; in Welcome, Scout's bubble is the `role="status"` line. The chat log is `role="log"`; errors are `role="alert"`; expert steps are `aria-live="polite"`.

## Do's and Don'ts

### Do:

- **Do** take colours, sizes, spacing and radii from `themeTokens`; add a token before adding another hard-coded value.
- **Do** draw Scout as Bean through `BeanClip`: moving on the dock, still (`still`, sized with `size`) everywhere else.
- **Do** keep gold for the one primary action, an on or pressed control, and Scout's active marks.
- **Do** pair every status with a word (and an icon where there is room).
- **Do** keep pixel type to names, titles and short uppercase headings; set sentences and controls in Onest.
- **Do** stop every animation under `prefers-reduced-motion`.
- **Do** build new bubble cards from `HANDOFF_CSS`: a lead sentence, labelled rows, one Gold primary and a quiet Cancel.

### Don't:

- **Don't** draw Scout any other way than Bean's strips.
- **Don't** use gold for decoration or fills larger than a button.
- **Don't** signal state by colour alone.
- **Don't** set sentences, fields or errors in Pixelify Sans, or any text below 11px.
- **Don't** add drop shadows; separate with tone and hairlines.
