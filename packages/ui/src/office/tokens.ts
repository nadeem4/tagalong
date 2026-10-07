/**
 * Every visual value the Crew Office uses, in one place. Components read only from here,
 * so the look can change without touching component logic. Sprite palettes are character
 * art and live with the sprites instead.
 */
export const officeTokens = {
  color: {
    // The dark chrome: top bar and party list.
    page: '#12162B',
    text: '#E9ECF5',
    textMuted: '#A3AAC4',
    line: '#262C4A',
    sidebar: '#171C33',
    rowActive: '#1E2442',
    avatarTile: '#222845',
    field: '#1A1F3A',
    fieldLine: '#2E3558',
    /** A disabled control's label and border: dimmer than muted text, still 3:1 on the page. */
    disabledInk: '#6B7290',
    disabledLine: '#2A3050',
    gold: '#F2C14E',
    goldInk: '#12162B',
    // The office floor. Furniture colours live in the furniture sprites.
    floor: '#DCDBD7',
    floorGrid: '#D0CFCA',
    wall: '#2B3150',
    roomGlass: '#9FCBE0',
    roomFill: 'rgba(176, 214, 232, 0.22)',
    roomShine: 'rgba(255, 255, 255, 0.55)',
    roomLabel: '#2B3150',
    chipFree: '#E6E9F2',
    chipFreeInk: '#4A5168',
    plate: '#3F465C',
    // The light meetings panel.
    panel: '#F6F7FB',
    panelText: '#12162B',
    panelMuted: '#5A6178',
    panelLine: '#E0E3EC',
    panelTile: '#E6E9F2',
    meterOff: '#E0E3EC',
    scrollbarThumb: '#CDD2DE',
  },
  font: {
    ui: "'Onest', system-ui, sans-serif",
    pixel: "'Pixelify Sans', 'Onest', sans-serif",
  },
  fontSize: {
    /** The smallest functional text in the office. Nothing goes below it. */
    min: 11,
    small: 12,
    body: 13,
    field: 14,
    roomName: 13,
    partyHeading: 15,
    petName: 17,
    title: 20,
  },
  fontWeight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  space: { hair: 3, xxs: 2, xs: 4, sm: 6, md: 8, lg: 12, xl: 16, xxl: 20, xxxl: 24 },
  radius: { field: 8, row: 10, tile: 10, chip: 10, small: 8 },
  size: {
    headerHeight: 64,
    partyWidth: 280,
    fieldHeight: 40,
    partyTile: 56,
    focusRing: 2,
    focusOffset: 2,
    meterHeight: 10,
    emptyTextWidth: 300,
  },
  letterSpacing: { pixel: 1, title: 0.5 },
  /** Integer multipliers for sprites: a 16px pet drawn at 3 is 48px on screen. */
  spriteScale: { logo: 2, party: 3, floor: 3, furniture: 3, plant: 3, cursor: 2, tile: 2 },
  timing: {
    /** The idle bob is stepped, never eased: two frames, like a 16-bit sprite. */
    bob: '1.1s',
    hop: '0.7s',
    /** Seconds between neighbouring pets' bobs, so the crew does not move in lockstep. */
    bobStagger: 0.23,
  },
} as const;

export type OfficeTokens = typeof officeTokens;
