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
    /** Your own message tile in the chat. */
    mine: '#2A3160',
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
    okDot: '#2F9E44',
    warnFill: '#FFF4D6',
    warnInk: '#5C4600',
    /** The border of a warning chip or message. */
    warnLine: '#EED79A',
    /** A filled bar that has reached its limit (the spend meter). */
    warnBar: '#B7791F',
    errFill: '#FDE7E5',
    errInk: '#8A1C12',
    /** The surface of a card on the light page. */
    card: '#FFFFFF',
    /** The lighter tile on navy: chips, hovers, the job bar's track. */
    tileNavy: '#222845',
    /** Secondary text on navy, between text and textMuted. */
    textSoft: '#C9CEE0',
    /** A stronger line on navy: a hovered bubble, a quote rule. */
    lineStrong: '#3A4270',
    /** The code block's well on navy. */
    codeBg: '#0E1124',
    /** A quiet mark on navy: the dock's idle tag, a disabled step. */
    dim: '#6B7290',
    /** Text of a disabled primary button on the light page. */
    disabledInk: '#8A90A6',
    /** A warning word on navy. */
    warnOnNavy: '#F2D48A',
    /** An error on navy: its fill, text and link. */
    errNavyFill: '#3A1D2A',
    errNavyInk: '#FFB4C0',
    errNavyLink: '#FFD9DF',
    /** The Recommended tag. */
    recFill: '#DCE4FA',
    recInk: '#24326B',
    /** The dock's listening dot, and the brighter dot while it hears you. */
    listening: '#7DD87F',
    hearing: '#B8F5B9',
    /** The health card's dots on navy. */
    healthOk: '#7FD1A4',
    healthBad: '#FF8A9A',
    okOnNavy: '#8FD19E',
    disabledFill: '#EEF0F5',
    disabledChev: '#B4B9C9',
    /** The shared renderer sheet (app.css) and its slate. */
    slateInk: '#0F172A',
    slateMuted: '#64748B',
    slateLine: '#E2E8F0',
    slateErr: '#B91C1C',
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
  space: {
    hair: 3,
    xxs: 2,
    xs: 4,
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 20,
    xxxl: 24,
    page: 32,
    section: 40,
    hero: 48,
  },
  /** card: boxes and big tiles; sm: fields, small tiles and buttons; pill: chips and toggles. */
  radius: { card: 12, pill: 999, sm: 8 },
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

/**
 * The light-page colours that change with the system's dark setting, and their dark values
 * (the navy-family counterpart in the approved mockups). Gold, the navy chrome and the
 * status bar stay as they are in both.
 */
const darkSurface = {
  panel: '#0F1325',
  panelText: '#E9ECF5',
  panelMuted: '#A3AAC4',
  panelLine: '#2A3152',
  panelTile: '#222845',
  scrollbarThumb: '#2E3558',
  link: '#A9BCF5',
  okFill: '#17301F',
  okInk: '#9ADBA6',
  okDot: '#7DD87F',
  warnFill: '#33280E',
  warnInk: '#F2D48A',
  warnLine: '#5C4A1A',
  errFill: '#3A1D2A',
  errInk: '#FFB4C0',
  card: '#171C36',
  controlFill: '#1A1F3A',
  keycapFill: '#1A1F3A',
  keycapLine: '#3A4270',
  keycapInk: '#E9ECF5',
  chipFree: '#222845',
  chipFreeInk: '#C9CEE0',
  disabledInk: '#6B7290',
  disabledFill: '#222845',
  disabledChev: '#3A4270',
  recFill: '#222B52',
  recInk: '#C4D2FA',
} as const;

type SurfaceKey = keyof typeof darkSurface;

/**
 * The same colours as CSS: `var(--tg-name, light)`. Under `.home` and `.wt` the variable
 * follows the system; anywhere else (Settings, the bubble) it is unset and the light value applies.
 */
export const themedColor = Object.fromEntries(
  (Object.keys(darkSurface) as SurfaceKey[]).map((k) => [
    k,
    `var(--tg-${k}, ${themeTokens.color[k]})`,
  ]),
) as Record<SurfaceKey, string>;

const surfaceVars = (values: Record<SurfaceKey, string>): string =>
  (Object.keys(darkSurface) as SurfaceKey[]).map((k) => `--tg-${k}: ${values[k]};`).join(' ');

/** Defines the variables for Home and the tour: light by default, dark when the system is. */
export const THEME_CSS = `
.home, .wt { ${surfaceVars(themeTokens.color)} color-scheme: light; }
@media (prefers-color-scheme: dark) {
  .home, .wt {
    ${surfaceVars(darkSurface)}
    --tg-focus: ${themeTokens.color.focusOnNavy};
    --tg-ctl-bg: ${darkSurface.controlFill};
    --tg-ctl-line: ${darkSurface.keycapLine};
    --tg-ctl-ink: ${darkSurface.panelText};
    --tg-ctl-muted: ${darkSurface.panelMuted};
    color-scheme: dark;
  }
}
`;
