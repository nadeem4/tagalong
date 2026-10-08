---
name: Tagalong
description: A 16-bit crew of AI companions at work in a modern pixel-art office.
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
  disabled-ink: '#6B7290'
  disabled-line: '#2A3050'
  gold: '#F2C14E'
  gold-ink: '#12162B'
  concrete-floor: '#DCDBD7'
  floor-grid: '#D0CFCA'
  wall: '#2B3150'
  room-glass: '#9FCBE0'
  room-fill: 'rgba(176, 214, 232, 0.22)'
  room-shine: 'rgba(255, 255, 255, 0.55)'
  room-label: '#2B3150'
  chip-free: '#E6E9F2'
  chip-free-ink: '#4A5168'
  name-plate: '#3F465C'
  panel-white: '#F6F7FB'
  panel-text: '#12162B'
  panel-muted: '#5A6178'
  panel-line: '#E0E3EC'
  panel-tile: '#E6E9F2'
  meter-off: '#E0E3EC'
  scrollbar-thumb: '#CDD2DE'
  scrim: 'rgba(18, 22, 43, 0.72)'
  job-generalist: '#4FD1C1'
  job-writer: '#A996F5'
  job-backend: '#F6B85A'
  job-frontend: '#F28DB8'
  job-researcher: '#7DD87F'
typography:
  office-title:
    fontFamily: "'Pixelify Sans', 'Onest', sans-serif"
    fontSize: '20px'
    fontWeight: 700
    letterSpacing: '0.5px'
  pet-name:
    fontFamily: "'Pixelify Sans', 'Onest', sans-serif"
    fontSize: '17px'
    fontWeight: 600
  panel-heading-pixel:
    fontFamily: "'Pixelify Sans', 'Onest', sans-serif"
    fontSize: '15px'
    fontWeight: 600
    letterSpacing: '1px'
  room-label:
    fontFamily: "'Pixelify Sans', 'Onest', sans-serif"
    fontSize: '13px'
    fontWeight: 700
    letterSpacing: '1px'
  job-class:
    fontFamily: "'Pixelify Sans', 'Onest', sans-serif"
    fontSize: '11px'
    fontWeight: 400
    letterSpacing: '1px'
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
  label-min:
    fontFamily: "'Onest', system-ui, sans-serif"
    fontSize: '11px'
    fontWeight: 600
rounded:
  small: '8px'
  field: '8px'
  row: '10px'
  tile: '10px'
  chip: '10px'
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
  button-primary-disabled:
    backgroundColor: 'transparent'
    textColor: '{colors.disabled-ink}'
    rounded: '{rounded.field}'
    padding: '0 16px'
    height: '40px'
  toggle:
    backgroundColor: 'transparent'
    textColor: '{colors.shell-muted}'
    rounded: '{rounded.field}'
    padding: '0 12px'
    height: '40px'
  toggle-pressed:
    backgroundColor: 'transparent'
    textColor: '{colors.gold}'
    rounded: '{rounded.field}'
    padding: '0 12px'
    height: '40px'
  field:
    backgroundColor: '{colors.field-navy}'
    textColor: '{colors.shell-text}'
    rounded: '{rounded.field}'
    padding: '0 12px'
    height: '40px'
  party-row:
    backgroundColor: 'transparent'
    textColor: '{colors.shell-text}'
    rounded: '{rounded.row}'
    padding: '8px'
  party-row-selected:
    backgroundColor: '{colors.row-active}'
    textColor: '{colors.shell-text}'
    rounded: '{rounded.row}'
    padding: '8px'
  avatar-tile:
    backgroundColor: '{colors.avatar-tile}'
    rounded: '{rounded.tile}'
    padding: '4px'
  room-chip-free:
    backgroundColor: '{colors.chip-free}'
    textColor: '{colors.chip-free-ink}'
    typography: '{typography.label-min}'
    rounded: '{rounded.chip}'
    padding: '2px 8px'
  party-list:
    backgroundColor: '{colors.sidebar-navy}'
    width: '280px'
    padding: '16px 14px'
  header:
    backgroundColor: '{colors.shell-navy}'
    height: '64px'
    padding: '0 20px'
  meetings-panel:
    backgroundColor: '{colors.panel-white}'
    textColor: '{colors.panel-text}'
  home-tab:
    backgroundColor: 'transparent'
    textColor: '{colors.panel-muted}'
    typography: '{typography.body}'
    height: '40px'
    padding: '0 12px'
  home-tab-selected:
    backgroundColor: 'transparent'
    textColor: '{colors.panel-text}'
    typography: '{typography.body}'
    height: '40px'
    padding: '0 12px'
  activity-entry:
    backgroundColor: 'transparent'
    textColor: '{colors.panel-text}'
    rounded: '{rounded.row}'
    padding: '8px'
  activity-entry-open:
    backgroundColor: '{colors.panel-tile}'
    textColor: '{colors.panel-text}'
    rounded: '{rounded.row}'
    padding: '8px'
  roles-notice:
    backgroundColor: '{colors.sidebar-navy}'
    textColor: '{colors.shell-text}'
    rounded: '{rounded.tile}'
    width: '660px'
    padding: '24px 28px'
---

# Design System: Tagalong

## Overview

**Creative North Star: "The Party in the Glass Office"**

Tagalong's crew is a 16-bit party with job classes, working in a contemporary office drawn in pixel art. The characters are expressive game sprites; the room they sit in is modern (pale concrete floor, white desks with monitors, glass-walled meeting rooms, plants, a small lounge); the interface around them is crisp, modern product chrome. The game lives inside the frame, never on the frame: the shell is a deep ink-navy app with clean sans type, off-white panels and one gold accent, and the pixel world is the picture it holds.

Every colour, font, size, spacing step, radius and timing comes from one source, `packages/ui/src/office/tokens.ts` (`officeTokens`); components read only from there. Sprite palettes are character and furniture art and live with the sprites, not in the tokens. Sprites are plain data (a map of rows, a palette, optional overlay pixels) rendered as a CSS `box-shadow` on a single 1px element and scaled up by a whole number. No images, no canvas, no 3D.

The main surface is **Home**, the control centre: a 64px top bar, a 280px agent list, the themed scene in the centre (the Office floor today) and a light right panel with three tabs: Activity, the picked agent's controls, and Meetings. Status is always an icon plus a word. Motion is a stepped two-frame idle, off whenever the user asks for stillness.

**Key Characteristics:**

- Ink-navy shell, off-white panels, pale concrete floor: three grounds, one per job.
- Gold (`gold`) means selection and attention, and nothing else.
- One colour per job class, used only on that class's label.
- Pixel type for names and short labels; Onest for everything you read.
- Sprites as data, drawn at integer scale only.
- Stepped, never eased, motion; stops for reduced motion and the Still office toggle.

## Colors

A cool ink-navy shell and cool off-white panels frame a warm-grey concrete floor; a single warm gold carries selection, and each job class owns one saturated label colour.

### Primary

- **Party Gold** (gold): the selection ring on the chosen party row, the cursor that hops above the selected pet, the focus outline, text selection, the primary button fill and a pressed toggle's border and label. Ink on gold is always **Gold Ink** (gold-ink), the shell navy.

### Secondary

- **Job-class inks** (job-generalist teal, job-writer violet, job-backend amber, job-frontend pink, job-researcher green): each job class's small-caps label in the agent list. Chosen to read on the sidebar navy. The class is the pet's role: the label is the role's name and the ink is keyed by role id in `officeTokens.roleInk`. A pet whose role is unknown reads "GENERALIST" in the generalist ink; a role without an ink of its own uses the shell muted text.

### Neutral

- **Ink Navy** (shell-navy): the page and top bar; the darkest ground.
- **Sidebar Navy** (sidebar-navy): the agent list, one step lighter than the page.
- **Active Row Navy** (row-active): a hovered or selected party row.
- **Avatar Tile** (avatar-tile): the square behind each party sprite.
- **Field Navy** (field-navy) with **Field Line** (field-line): text inputs and the unpressed toggle border.
- **Shell Line** (shell-line): the hairline under the top bar.
- **Frost Text** (shell-text) and **Shell Muted** (shell-muted): primary and secondary text on navy; muted also carries status lines, placeholders and the party heading.
- **Disabled Ink / Disabled Line** (disabled-ink, disabled-line): a disabled control's label and border; dimmer than muted, still 3:1 on the page.
- **Pale Concrete** (concrete-floor) with **Floor Grid** (floor-grid): the office floor and its 2px tile grid.
- **Wall Navy** (wall): the window wall along the top of the floor. **Room Label** (room-label) is the same navy for room names.
- **Room Glass** (room-glass), **Room Fill** (room-fill), **Room Shine** (room-shine): a meeting room's 4px glass wall, its translucent tint and the inner highlight.
- **Free Chip** (chip-free / chip-free-ink): the "Free" status chip beside a room name.
- **Name Plate** (name-plate): a pet's name under its desk.
- **Panel White** (panel-white), **Panel Text** (panel-text), **Panel Muted** (panel-muted), **Panel Line** (panel-line), **Panel Tile** (panel-tile): the light meetings panel and its dividers.
- **Meter Off** (meter-off): an unlit call-meter segment. **Scrollbar Thumb** (scrollbar-thumb): the 8px scrollbar.
- **Scrim** (scrim): the page navy at 72% behind a modal dialog, such as the roles notice.

### Named Rules

**The Gold Means You Rule.** Gold marks what is selected, focused or needs the user: the selected row, the cursor, the focus ring, the primary action, a pressed toggle. It never decorates, never fills a panel, and never names a job class.

**The One Colour Per Class Rule.** Each job class owns exactly one label ink, keyed by role id in the office tokens (`roleInk`), used only on that class's job label. The ink belongs to the role, never to a pet, so two pets with the same role share it. Adding a class means adding one ink that reads on the sidebar navy and stays clearly distinct from gold.

**The Three Grounds Rule.** Navy is chrome (bar, agent list), off-white is reading (panels, threads, the activity view, agent controls), pale concrete is the world (the floor). A new surface picks the ground for its job; it does not invent a fourth.

## Typography

**Display Font:** Pixelify Sans (with Onest, sans-serif), weights 400, 600, 700
**Body Font:** Onest (with system-ui, sans-serif), weights 400, 600

Both are bundled from `@fontsource` (Latin subset) so the window makes no network request.

**Character:** A chunky pixel face gives the crew and their rooms game voice; a clean geometric sans keeps every sentence, control and number modern and easy to read.

### Hierarchy

- **Office title** (Pixelify 700, 20px, 0.5px tracking): the office name in the top bar, beside a 2x pet sprite.
- **Pet name** (Pixelify 600, 17px): a pet's name in the agent list; also the empty-state line in the meetings panel.
- **Panel heading, pixel** (Pixelify 600, 15px, 1px tracking, uppercase): short panel headings such as "AGENTS · 3".
- **Room label** (Pixelify 700, 13px, 1px tracking, uppercase): meeting room names on the floor.
- **Job class** (Pixelify 400, 11px, 1px tracking, uppercase): the job label under a pet name, in its class ink; desk name plates use the same style in Name Plate.
- **Title** (Onest 600, 14px): buttons, inputs and the meetings panel's heading.
- **Body lead** (Onest 400, 14px, 1.5 line height, max 300px): explanatory paragraphs such as empty-state text.
- **Body** (Onest 400, 13px): header meta (rooms free), the toggle label, notices.
- **Label** (Onest 400, 12px): status lines, panel sublines, the call meter labels.
- **Label min** (Onest 600, 11px): room status chips. 11px is the floor; nothing in the office goes smaller.

### Named Rules

**The Pixel Is A Name Rule.** Pixelify Sans is for names and short labels only: pet names, job classes, room labels, desk plates, the office title and short panel headings. Sentences, controls, inputs, statuses and numbers are Onest.

**The 11px Floor Rule.** No functional text below 11px (`fontSize.min`).

## Layout

Home is a fixed three-column desktop window (1440x800 by default) under a 64px top bar. The agent list is a fixed 280px column on Sidebar Navy; the theme's scene sits in the centre at its natural pixel size; the right panel takes the remaining width, with its tabs (Activity, the picked agent's name, Meetings) across the top. The top bar aligns its title block ("Home") to the agent column, then runs the assign field (flexible), the Assign button, the Still office toggle and the rooms-free meta.

**The Chrome Never Moves Rule.** Home is fixed chrome around one themed scene. The top bar, the agent list, the right panel and every control keep the same place, size and look in every theme; a theme (`Theme` in `packages/ui/src/home/theme.ts`: an id, a name, a layout, sprites, scene tokens and one Scene renderer) only changes the centre scene. A theme never adds a control, and the chrome never reads a theme's scene tokens. The Office is the only theme today; a Restaurant or a Factory would be one more registry entry.

Spacing runs on a small 2-to-24px scale (xxs 2, hair 3, xs 4, sm 6, md 8, lg 12, xl 16, xxl 20, xxxl 24). Controls are 40px tall. Party rows gap 6px; inside a row the sprite and text gap 12px.

The floor is a positioned world, not a flow layout: desks, rooms, furniture and plants sit at coordinates from `layout.ts`, all drawn at sprite scale 3. Sprite scales are whole numbers by job: logo 2, party 3, floor 3, furniture 3, plant 3, cursor 2.

**The Integer Scale Rule.** A sprite is drawn at a whole-number scale (`spriteScale`) and nothing else. Pixel art scaled by a fraction smears.

## Elevation & Depth

Flat. The chrome uses tonal layering, not shadows: the page navy, a lighter sidebar navy, a lighter active-row navy, and hairline dividers (Shell Line on navy, Panel Line on off-white). The only `box-shadow`s are structural: every sprite is itself a box-shadow (one unblurred 1px shadow per pixel), and a meeting room's glass carries an inset 2px Room Shine highlight. Depth in the world comes from the pixel art (desk fronts, chair backs, the glass tint), not from the chrome.

### Shadow Vocabulary

- **Sprite pixel** (`box-shadow: <x>px <y>px 0 0 <colour>`, one per painted pixel): how every character and piece of furniture is drawn.
- **Glass shine** (`box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.55)`): inside a meeting room's glass wall.

**The No Lift Rule.** Chrome never floats: no drop shadows on panels, rows, buttons or cards. Hierarchy is tone and hairlines.

## Shapes

Modern chrome, square world. Controls and inputs use gently rounded 8px corners; party rows, avatar tiles and chips use 10px. The pixel world has no radius at all: rooms are square glass rectangles, the floor is a square 2px grid, call-meter segments are square blocks. Selection is a 2px gold border following the row's 10px radius. Icons are 14 to 16px stroked line SVGs (1.6 stroke, currentColor).

## Components

### Buttons

Calm and solid; gold only where the action is primary.

- **Shape:** gently rounded (8px), 40px tall.
- **Primary:** Party Gold fill and border, Gold Ink label, Onest 600 14px, 16px side padding.
- **Disabled:** transparent fill, Disabled Line border, Disabled Ink label, not-allowed cursor.
- **Toggle (Still office):** transparent with a Field Line border and Shell Muted label (Onest 600 13px, 12px padding); hover lifts the label to Frost Text; pressed (`aria-pressed`) turns border and label gold.
- **Focus:** every focusable element shows a 2px gold outline at 2px offset.

### Inputs / Fields

- **Style:** Field Navy fill, 1px Field Line border, 8px radius, 40px tall, Onest 14px, Shell Muted placeholder.
- **Focus:** the shared 2px gold outline.
- **Disabled:** not-allowed cursor; a title explains why.

### Navigation: Agent List

- **Style:** a `nav` ("Agents") on Sidebar Navy, 280px wide, headed by a pixel panel heading with the crew count ("AGENTS · 3"). Picking a row selects that agent in the scene and opens its controls in the right panel.
- **Row:** a real button (`aria-pressed`) with a 2px transparent border, 10px radius and 8px padding: avatar tile (Avatar Tile, 4px padding, sprite at 3x), then pet name (pixel 17px), job class (pixel 11px in its class ink) and status line.
- **Hover:** Active Row Navy fill. **Selected:** Active Row Navy fill and a gold border.

### Status Line

Status is an icon and a word, never colour alone: a 14px stroked SVG plus "Working" or "At desk", Onest 12px in Shell Muted. A pet's monitor on the floor is lit (teal screen) while it is working.

### Chips

- **Room status:** Free Chip fill, Free Chip Ink label, Onest 600 11px, 2px 8px padding, 10px radius, beside the room's pixel label.

### Right Panel Tabs

Off-white, under the top bar's right side: Activity, the picked agent's name, Meetings. Each tab is Onest 600 13px in Panel Muted, 40px tall, with a 2px transparent bottom border; the selected tab is Panel Text over a 2px gold underline (gold is selection). Left and right arrows move between tabs; every panel stays mounted.

### Activity View

The Activity tab lists what the crew did, newest first, on Panel White. Each entry is a real button (`aria-expanded`) with a 10px radius and 8px padding: the pet's sprite at 2x, a headline in Onest 600 14px ("Scout answered", "Scout asked Bolt", "Scout handed off to Ink", "Ink started a roundtable"), a meta line in Onest 12px Panel Muted (a 14px state icon and its word, Working, Done, Failed or Stopped, then the model, the call count and the time), and a one-line Onest 13px preview. Hover and open fill Panel Tile. Open, the thread sits below, indented past the sprite behind a 2px Panel Line rule: small Onest 600 12px labels ("Asked", "Bolt answered") over Onest 13px text at 1.5 line height. "Show older" (quiet button) pages back.

### Agent Controls

The picked agent's tab is the Settings pet editor in one column on Panel White: role picker, brain with the Recommended or Your choice chip, tool switches, notes, the directory card (static, not sticky), look and reply, a **Desktop pet** group, then "Save Name" (primary gold) and a quiet "Delete Name" that asks once more.

### Meetings Panel

Off-white reading surface: a heading block (Onest 600 14px plus a 12px muted subline) over a Panel Line divider, the thread area, and a call meter of 12 square 10px-tall segments (Meter Off when unlit) between "Calls" and a count. Empty state: two crew sprites at 3x, a pixel "No meetings yet" line and a 300px Onest paragraph.

### Roles Notice

The one-time "Your crew has roles now" dialog over the office, shown after an install from before roles is upgraded. A modal `<dialog>` on Sidebar Navy (it is chrome, and the job-class inks are tuned for that navy), 660px wide, 10px radius, a 1px Field Line border and no shadow, over a Scrim (`scrim`, the page navy at 72%) that keeps the office visible but receded. The title is the office-title style; one Body lead sentence in Shell Muted; then a table, one row per upgraded pet: avatar tile with the sprite at 2x and the pet name (pixel 17px), a muted arrow, the new role as a job-class label in its class ink, and what happened in Onest 13px. A "What changed?" text button (Onest 600 13px, underlined, `aria-expanded`) opens a Field Navy box of three short lines. The footer ends on "Review my crew" (toggle style, opens the first agent's controls in Home's right panel) and "Got it" (primary gold, focused on open); both, and Escape, mark the notice seen.

### Pixel Sprite (signature)

Any sprite is data: `rows` (one character per pixel, `.` transparent), a `palette` mapping characters to colours, and optional `overlay` pixels (`[x, y, key]`) painted on top so characters share one 16x16 body and differ by palette and a few pixels. `PixelSprite` draws it as a box-shadow on one 1px element scaled by `transform: scale(n)` with n a whole number; it is `aria-hidden`, and the name beside it is what assistive tech reads. Characters live in `sprites/characters.ts` keyed by pet id (adding a character is adding an entry); furniture (desks, monitors lit and dark, chairs, meeting tables, sofa, rug, bookshelf, water cooler, plants) lives in `sprites/furniture.ts`.

### Cursor

A 7x4 gold down-pointing sprite at 2x that hops above the selected pet on the floor.

### Motion

- **Idle bob:** each seated pet steps up 3px and back, `1.1s steps(1) infinite`: two frames, never eased. Neighbouring pets are offset by 0.23s so the crew does not move in lockstep.
- **Cursor hop:** the cursor steps down 3px and back, `0.7s steps(1) infinite`.
- **Stillness:** both stop under `prefers-reduced-motion: reduce` and when the Still office toggle is on (remembered locally). The office must read completely when still.

## Do's and Don'ts

### Do:

- **Do** take every colour, size, space, radius and timing from `officeTokens`; add a token before adding a value.
- **Do** draw characters and furniture as sprite data (rows, palette, overlay) through `PixelSprite`, at a whole-number `spriteScale`.
- **Do** reserve gold for selection, focus, the cursor and the one primary action on a surface.
- **Do** give each job class one label ink, and pair every status with an icon and a word.
- **Do** keep pixel type to names and short labels; set sentences, controls and numbers in Onest.
- **Do** make every idle animation stepped and stop it for `prefers-reduced-motion` and the Still office setting.
- **Do** build Hire a pet, Pet settings and the chat panel from these tokens: navy chrome, off-white reading panels, 40px gold primary button, 8px fields, the gold focus ring, party-row selection for choosing a pet or class, sprites at scale 3 for previews and 2 for small marks, and character ink for job labels.

### Don't:

- **Don't** scale a sprite by a fraction, smooth it, or replace it with an image or icon.
- **Don't** use gold for decoration, job classes, or fills larger than a button.
- **Don't** signal state by colour alone.
- **Don't** set body copy, inputs, errors or any sentence in Pixelify Sans, or any text below 11px.
- **Don't** ease the idle motion or add motion that cannot be stopped.
- **Don't** add drop shadows to chrome; separate with tone and hairlines.
- **Don't** reintroduce the wooden, old-RPG office or the generic chat-sidebar assistant look.
