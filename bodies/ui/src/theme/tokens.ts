/**
 * Design tokens shared by Home, Settings, the bubble and the dock: colours, fonts, the seven
 * type roles, spacing and radii. Contains themeTokens and typeCss.
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
    errFill: '#FDE7E5',
    errInk: '#8A1C12',
  },
  font: {
    ui: "'Onest', system-ui, sans-serif",
    /** The name "Scout": Onest at 600, like every other heading. */
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
  /** The seven type roles (size and line in px). Onest at 400 or 600 only. */
  type: {
    display: { size: 26, line: 32, weight: 600 },
    heading: { size: 20, line: 28, weight: 600 },
    title: { size: 16, line: 22, weight: 600 },
    bodyLead: { size: 14, line: 21, weight: 400 },
    body: { size: 13, line: 20, weight: 400 },
    small: { size: 12, line: 16, weight: 400 },
    caption: { size: 11, line: 14, weight: 600 },
  },
  /** The dock pet's tag: the one size outside the roles. */
  dockTag: 9,
  fontWeight: { regular: 400, semibold: 600, wordmark: 600 },
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
} as const;

export type TypeRole = keyof typeof themeTokens.type;

/** A role as the font-size, line-height and weight declarations of a style string. */
export function typeCss(role: TypeRole): string {
  const { size, line, weight } = themeTokens.type[role];
  return `font-size:${size}px;line-height:${line}px;font-weight:${weight}`;
}
