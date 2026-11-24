/**
 * Design tokens shared by Home, Settings, the bubble and the dock: colours, fonts, the seven
 * type roles, spacing and radii. Contains themeTokens, themedColor, THEME_CSS and typeCss.
 */

/**
 * Every colour that changes with the system's dark setting, declared once as light and dark.
 * `themeTokens.color` takes the light values; `themedColor` and THEME_CSS carry both. Gold, the
 * navy chrome and the spend bar stay the same in both themes.
 */
export const themed = {
  panel: { light: '#F6F7FB', dark: '#0F1325' },
  panelText: { light: '#12162B', dark: '#E9ECF5' },
  panelMuted: { light: '#5A6178', dark: '#A3AAC4' },
  panelLine: { light: '#E0E3EC', dark: '#2A3152' },
  panelTile: { light: '#E6E9F2', dark: '#222845' },
  scrollbarThumb: { light: '#CDD2DE', dark: '#2E3558' },
  link: { light: '#3D4A8A', dark: '#A9BCF5' },
  okFill: { light: '#E3F1E6', dark: '#17301F' },
  okInk: { light: '#1F5A2E', dark: '#9ADBA6' },
  okDot: { light: '#2F9E44', dark: '#7DD87F' },
  warnFill: { light: '#FFF4D6', dark: '#33280E' },
  warnInk: { light: '#5C4600', dark: '#F2D48A' },
  warnLine: { light: '#EED79A', dark: '#5C4A1A' },
  errFill: { light: '#FDE7E5', dark: '#3A1D2A' },
  errInk: { light: '#8A1C12', dark: '#FFB4C0' },
  card: { light: '#FFFFFF', dark: '#171C36' },
  controlFill: { light: '#FFFFFF', dark: '#1A1F3A' },
  keycapFill: { light: '#FFFFFF', dark: '#1A1F3A' },
  keycapLine: { light: '#C9CEDC', dark: '#3A4270' },
  keycapInk: { light: '#12162B', dark: '#E9ECF5' },
  chipFree: { light: '#E6E9F2', dark: '#222845' },
  chipFreeInk: { light: '#4A5168', dark: '#C9CEE0' },
  disabledInk: { light: '#8A90A6', dark: '#6B7290' },
  disabledFill: { light: '#EEF0F5', dark: '#222845' },
  disabledChev: { light: '#B4B9C9', dark: '#3A4270' },
  recFill: { light: '#DCE4FA', dark: '#222B52' },
  recInk: { light: '#24326B', dark: '#C4D2FA' },
  disabledText: { light: '#6B7290', dark: '#8A92B0' },
  /** Focus ring: navy on the light page, gold on the dark one (and on navy surfaces in both). */
  focusRing: { light: '#12162B', dark: '#F2C14E' },
};

type ThemedKey = keyof typeof themed;
const themedKeys = Object.keys(themed) as ThemedKey[];

function themedSide(side: 'light' | 'dark'): Record<ThemedKey, string> {
  return Object.fromEntries(themedKeys.map((k) => [k, themed[k][side]])) as Record<
    ThemedKey,
    string
  >;
}

export const themeTokens = {
  color: {
    ...themedSide('light'),
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
    focusOnNavy: '#F2C14E',
    /** A filled bar that has reached its limit (the spend meter). */
    warnBar: '#B7791F',
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
    /** A warning word on navy. */
    warnOnNavy: '#F2D48A',
    /** An error on navy: its fill, text and link. */
    errNavyFill: '#3A1D2A',
    errNavyInk: '#FFB4C0',
    errNavyLink: '#FFD9DF',
    /** The dock's listening dot, and the brighter dot while it hears you. */
    listening: '#7DD87F',
    hearing: '#B8F5B9',
    /** The health card's dots on navy. */
    healthOk: '#7FD1A4',
    healthBad: '#FF8A9A',
    okOnNavy: '#8FD19E',
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
 * The same colours as CSS: `var(--tg-name, light)`. Under `.home` and `.wt` the variable
 * follows the system; anywhere else (Settings, the bubble) it is unset and the light value applies.
 */
export const themedColor = Object.fromEntries(
  themedKeys.map((k) => [k, `var(--tg-${k}, ${themed[k].light})`]),
) as Record<ThemedKey, string>;

const declarations = (side: 'light' | 'dark'): string =>
  themedKeys.map((k) => `--tg-${k}: ${themed[k][side]};`).join(' ');

/** Defines the dark variables for Home and the tour; the light values are the var() fallbacks. */
export const THEME_CSS = `
.home, .wt { color-scheme: light; }
@media (prefers-color-scheme: dark) {
  .home, .wt { ${declarations('dark')} color-scheme: dark; }
}
`;
