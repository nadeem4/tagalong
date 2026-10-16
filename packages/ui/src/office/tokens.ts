/**
 * Design tokens shared by Home, Settings, the bubble and the dock: colours, fonts, sizes,
 * spacing and radii. Contains officeTokens. Sprite palettes are character art and live in
 * `sprites/characters.ts`.
 */
export const officeTokens = {
  color: {
    // The dark chrome: top bars, side menus and the bubble.
    page: '#12162B',
    text: '#E9ECF5',
    textMuted: '#A3AAC4',
    line: '#262C4A',
    sidebar: '#171C33',
    rowActive: '#1E2442',
    field: '#1A1F3A',
    fieldLine: '#2E3558',
    gold: '#F2C14E',
    goldInk: '#12162B',
    chipFree: '#E6E9F2',
    chipFreeInk: '#4A5168',
    // The light page.
    panel: '#F6F7FB',
    panelText: '#12162B',
    panelMuted: '#5A6178',
    panelLine: '#E0E3EC',
    panelTile: '#E6E9F2',
    scrollbarThumb: '#CDD2DE',
    /** A link on the light panel. */
    link: '#3D4A8A',
    /** Status chips and messages on the light panel: done, needs attention, failed. */
    okFill: '#E3F1E6',
    okInk: '#1F5A2E',
    warnFill: '#FFF4D6',
    warnInk: '#5C4600',
    errFill: '#FDE7E5',
    errInk: '#8A1C12',
  },
  font: {
    ui: "'Onest', system-ui, sans-serif",
    pixel: "'Pixelify Sans', 'Onest', sans-serif",
  },
  fontSize: {
    /** The smallest functional text. Nothing goes below it. */
    min: 11,
    small: 12,
    body: 13,
    field: 14,
    groupHeading: 13,
    panelHeading: 15,
    title: 20,
  },
  fontWeight: { semibold: 600, bold: 700 },
  space: { hair: 3, xxs: 2, xs: 4, sm: 6, md: 8, lg: 12, xl: 16, xxl: 20, xxxl: 24 },
  radius: { field: 8, row: 10, tile: 10, chip: 10, small: 8 },
  size: {
    headerHeight: 64,
    navWidth: 280,
    fieldHeight: 40,
    focusRing: 2,
    focusOffset: 2,
    emptyTextWidth: 300,
  },
  letterSpacing: { pixel: 1, title: 0.5 },
  /** Integer multipliers for sprites: a 16px pet drawn at 2 is 32px on screen. */
  spriteScale: { tile: 2 },
} as const;
