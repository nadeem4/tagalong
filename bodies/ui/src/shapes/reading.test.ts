/** Tests for readingRowsOf: the brain's reading_status answer as Home's rows. */
import { describe, expect, it } from 'vitest';
import { readingRowsOf } from './reading';

const UIA = {
  capability: 'window-text',
  engine: 'windows-uia',
  where: 'this-pc',
  state: 'working',
};
const OCR = {
  capability: 'text-from-pictures',
  engine: 'windows-ocr',
  where: 'this-pc',
  state: 'working',
};

describe('readingRowsOf', () => {
  it('maps a working row to plain labels first', () => {
    const [row] = readingRowsOf(JSON.stringify({ rows: [UIA] }));
    expect(row).toMatchObject({
      title: 'Reading window text',
      engineLabel: 'Windows UI Automation',
      whereLabel: 'this PC',
      stateLabel: 'Working',
      fixable: false,
      plain: '',
    });
  });

  it('marks only needs-language-pack as fixable and names the language', () => {
    const [needs, broken] = readingRowsOf(
      JSON.stringify({
        rows: [
          { ...OCR, state: 'needs-language-pack', language: 'en-US' },
          { ...OCR, state: 'not-working' },
        ],
      }),
    );
    expect(needs).toMatchObject({ stateLabel: 'Needs a fix', fixable: true, language: 'en-US' });
    expect(needs?.plain).toContain('English (United States)');
    expect(broken?.fixable).toBe(false);
  });

  it('gives not-working one plain sentence and no fix', () => {
    const [row] = readingRowsOf(JSON.stringify({ rows: [{ ...OCR, state: 'not-working' }] }));
    expect(row?.stateLabel).toBe('Not working');
    expect(row?.plain).toContain('text in pictures');
    expect(row?.plain.match(/\./g)).toHaveLength(1);
  });

  it('falls back to the tag when the language has no name', () => {
    const [row] = readingRowsOf(
      JSON.stringify({ rows: [{ ...OCR, state: 'needs-language-pack', language: 'not a tag!' }] }),
    );
    expect(row?.plain).toContain('not a tag!');
  });

  it('returns [] for rows [] and for bad JSON', () => {
    expect(readingRowsOf('{"rows":[]}')).toEqual([]);
    expect(readingRowsOf('nope')).toEqual([]);
    expect(readingRowsOf('{"rows":[{"state":"x"}]}')).toEqual([]);
  });
});
