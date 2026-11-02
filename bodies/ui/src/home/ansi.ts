/**
 * A tiny ANSI reader for the job log: only SGR (bold and the 16 colours) is kept; cursor moves,
 * clears, private modes and OSC titles are dropped, and carriage-return progress lines collapse
 * to their last state. One linear scan, so a 64 KB line cannot freeze the page.
 * Contains parseAnsi, collapseCarriageReturns, AnsiSpan and AnsiColor.
 */
export type AnsiColor =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite';

export interface AnsiSpan {
  text: string;
  bold: boolean;
  color: AnsiColor | null;
}

const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;

function colorFor(code: number): AnsiColor | null {
  if (code >= 30 && code <= 37) return NAMES[code - 30] ?? null;
  if (code >= 90 && code <= 97) {
    const name = NAMES[code - 90] ?? 'black';
    return `bright${name[0]?.toUpperCase()}${name.slice(1)}` as AnsiColor;
  }
  return null;
}

// CSI sequences (final byte decides), OSC strings (BEL or ST end, never past the next ESC) and any
// other short escape such as charset selects, so nothing leaks as text.
// eslint-disable-next-line no-control-regex -- the escape byte is the whole point
const ESCAPE = /\x1b\[([0-?]*)([ -/]*[@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[ -/]*[0-~]?/g;

export function parseAnsi(text: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let bold = false;
  let color: AnsiColor | null = null;
  const push = (chunk: string): void => {
    if (chunk === '') return;
    const last = spans[spans.length - 1];
    if (last && last.bold === bold && last.color === color) last.text += chunk;
    else spans.push({ text: chunk, bold, color });
  };
  let from = 0;
  for (const match of text.matchAll(ESCAPE)) {
    push(text.slice(from, match.index));
    from = match.index + match[0].length;
    if (match[2] !== 'm' || !/^[0-9;]*$/.test(match[1] ?? '')) continue;
    const codes = (match[1] ?? '').split(';').map((c) => (c === '' ? 0 : Number(c)));
    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i] ?? 0;
      if (code === 0) {
        bold = false;
        color = null;
      } else if (code === 1) bold = true;
      else if (code === 22) bold = false;
      else if (code === 39) color = null;
      else if (code === 38 || code === 48) {
        // Extended colours are not drawn; skip their arguments (5;n or 2;r;g;b).
        i += codes[i + 1] === 2 ? 4 : 2;
      } else {
        const next = colorFor(code);
        if (next) color = next;
      }
    }
  }
  push(text.slice(from));
  return spans;
}

/** Each line keeps only the text after its last bare `\r`; `\r\n` stays a newline. */
export function collapseCarriageReturns(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.slice(line.lastIndexOf('\r') + 1))
    .join('\n');
}
