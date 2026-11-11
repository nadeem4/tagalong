/**
 * Design tokens shared by Home, Settings, the bubble and the dock: colours, fonts, sizes,
 * spacing and radii. Contains themeTokens.
 */
export const themeTokens = {
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
    /** Sky blue: the job log's edit lines (the bubble hard-codes the same blue). */
    sky: '#7CB8F2',
    goldInk: '#12162B',
    /** Focus ring: navy on light surfaces, gold on navy ones. */
    focusOnLight: '#12162B',
    focusOnNavy: '#F2C14E',
    /** Fill of fields and secondary buttons on the light page. */
    controlFill: '#FFFFFF',
    /** Keycaps (a shortcut key drawn as a key). */
    keycapFill: '#FFFFFF',
    keycapLine: '#C9CEDC',
    keycapInk: '#12162B',
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
    /** The border of a warning chip or message. */
    warnLine: '#EED79A',
    /** A filled bar that has reached its limit (the spend meter). */
    warnBar: '#B7791F',
    errFill: '#FDE7E5',
    errInk: '#8A1C12',
  },
  font: {
    ui: "'Onest', system-ui, sans-serif",
    pixel: "'Pixelify Sans', 'Onest', sans-serif",
    /** The name "Scout": Onest, never the pixel font (its c reads as o). */
    wordmark: "'Onest', system-ui, sans-serif",
    mono: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
  },
  /** The 16 terminal colours, tuned to read on the navy of the job log. */
  ansi: {
    black: '#6B7394',
    red: '#F28B82',
    green: '#8FD19E',
    yellow: '#F2C14E',
    blue: '#7CB8F2',
    magenta: '#C9A0F2',
    cyan: '#7FD6D9',
    white: '#C9CEDC',
    brightBlack: '#8A92B0',
    brightRed: '#FFADA6',
    brightGreen: '#B1E5BC',
    brightYellow: '#FFD97A',
    brightBlue: '#A6D0F7',
    brightMagenta: '#DEC2F7',
    brightCyan: '#A6E8EA',
    brightWhite: '#FFFFFF',
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
  fontWeight: { semibold: 600, bold: 700, wordmark: 600 },
  space: { hair: 3, xxs: 2, xs: 4, sm: 6, md: 8, lg: 12, xl: 16, xxl: 20, xxxl: 24, page: 32 },
  radius: { field: 8, row: 10, tile: 10, chip: 10, small: 8 },
  size: {
    headerHeight: 64,
    navWidth: 280,
    fieldHeight: 40,
    focusRing: 2,
    focusOffset: 2,
    emptyTextWidth: 300,
    toggleW: 44,
    toggleH: 24,
    /** Height of buttons, selects and fields in the shared controls. */
    control: 36,
  },
  letterSpacing: { pixel: 1, title: 0.5 },
} as const;
