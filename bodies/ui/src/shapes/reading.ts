/**
 * What Home's "How Scout reads your screen" group reads of the brain's reading_status answer:
 * plain words first (Working, Needs a fix), engine names second. Contains readingRowsOf and
 * ReadingRowView. Bad JSON gives no rows, which hides the group.
 */
import { z } from 'zod';

const Row = z.object({
  capability: z.enum(['window-text', 'text-from-pictures']),
  engine: z.enum(['windows-uia', 'windows-ocr']),
  where: z.literal('this-pc'),
  state: z.enum(['working', 'needs-language-pack', 'not-working']),
  language: z.string().optional(),
});
const Wire = z.object({ rows: z.array(Row) });

type WireRow = z.infer<typeof Row>;

export interface ReadingRowView {
  capability: WireRow['capability'];
  engine: WireRow['engine'];
  where: WireRow['where'];
  state: WireRow['state'];
  language?: string | undefined;
  title: string;
  engineLabel: string;
  whereLabel: string;
  stateLabel: string;
  /** Only a missing language pack can be fixed from Home. */
  fixable: boolean;
  /** One plain sentence for a row that is not working; empty when it works. */
  plain: string;
}

const TITLE = { 'window-text': 'Reading window text', 'text-from-pictures': 'Text from pictures' };
const ENGINE = { 'windows-uia': 'Windows UI Automation', 'windows-ocr': 'Windows OCR' };
const STATE = {
  working: 'Working',
  'needs-language-pack': 'Needs a fix',
  'not-working': 'Not working',
};

function languageName(tag: string): string {
  try {
    return (
      new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' }).of(tag) ??
      tag
    );
  } catch {
    return tag;
  }
}

function plainOf(row: WireRow): string {
  const what = row.capability === 'window-text' ? 'the text in windows' : 'text in pictures';
  if (row.state === 'working') return '';
  if (row.state === 'needs-language-pack') {
    const lang = row.language === undefined ? 'your language' : languageName(row.language);
    return `Windows has no text-recognition pack for ${lang}, so Scout can't read ${what}.`;
  }
  return `Scout can't read ${what} on this PC right now.`;
}

export function readingRowsOf(json: string): ReadingRowView[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  const parsed = Wire.safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.rows.map((row) => ({
    ...row,
    title: TITLE[row.capability],
    engineLabel: ENGINE[row.engine],
    whereLabel: 'this PC',
    stateLabel: STATE[row.state],
    fixable: row.state === 'needs-language-pack',
    plain: plainOf(row),
  }));
}
