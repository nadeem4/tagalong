/**
 * Tests for ReadingRows: the "How Scout reads your screen" group, its two rows with plain words
 * before engine names, and the fix box for a missing Windows language pack.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '../host-bridge';
import { readingRowsOf } from '../shapes';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { ReadingRows } from './reading-rows';

const UIA = { capability: 'window-text', engine: 'windows-uia', where: 'this-pc' };
const OCR = { capability: 'text-from-pictures', engine: 'windows-ocr', where: 'this-pc' };

const rowsOf = (...rows: object[]) => readingRowsOf(JSON.stringify({ rows }));

function renderRows(rows: ReturnType<typeof rowsOf>) {
  const bridge = createFakeHostBridge();
  const view = render(
    <HostBridgeProvider bridge={bridge}>
      <ReadingRows rows={rows} />
    </HostBridgeProvider>,
  );
  return { bridge, ...view };
}

describe('ReadingRows', () => {
  it('renders the group title "How Scout reads your screen" with both rows', () => {
    renderRows(rowsOf({ ...UIA, state: 'working' }, { ...OCR, state: 'working' }));
    expect(screen.getByText('How Scout reads your screen')).toBeVisible();
    expect(screen.getByText('Reading window text')).toBeVisible();
    expect(screen.getByText('Text from pictures')).toBeVisible();
    expect(screen.getByText(/Windows UI Automation/)).toBeVisible();
    expect(screen.getByText(/Windows OCR/)).toBeVisible();
  });

  it('shows Working before the engine name, in words beside the colour', () => {
    renderRows(rowsOf({ ...UIA, state: 'working' }));
    const row = screen.getByText('Reading window text').closest('p') as HTMLElement;
    const chip = screen.getByText('Working');
    expect(chip.closest('.tg-chip')).toHaveClass('tg-chip--ok');
    expect(row).toHaveTextContent('Windows UI Automation · this PC');
    expect(row.textContent?.indexOf('Reading window text')).toBeLessThan(
      row.textContent?.indexOf('Windows UI Automation') ?? -1,
    );
  });

  it('hides the group with no rows', () => {
    const { container } = renderRows([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('a working row has no fix box', () => {
    renderRows(rowsOf({ ...OCR, state: 'working' }));
    expect(screen.queryByRole('button', { name: 'Ask Scout to fix it' })).toBeNull();
    expect(screen.queryByText('Do it myself in Windows Settings')).toBeNull();
  });

  it('shows the fix box for needs-language-pack and asks Scout with "Fix text from pictures"', () => {
    const { bridge } = renderRows(
      rowsOf({ ...OCR, state: 'needs-language-pack', language: 'en-US' }),
    );
    expect(screen.getByText('Needs a fix').closest('.tg-chip')).toHaveClass('tg-chip--warn');
    expect(
      screen.getByText(/no text-recognition pack for English \(United States\)/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Scout to fix it' }));
    expect(bridge.readingCalls).toEqual(['ask Fix text from pictures']);
  });

  it('not-working shows no Ask Scout button, only the sentence and the Settings link', () => {
    renderRows(rowsOf({ ...OCR, state: 'not-working' }));
    expect(screen.getByText('Not working').closest('.tg-chip')).toHaveClass('tg-chip--err');
    expect(screen.getByText(/can't read text in pictures/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Ask Scout to fix it' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Do it myself in Windows Settings' })).toBeVisible();
  });

  it('the Settings link calls openLanguageSettings with no argument', () => {
    const { bridge } = renderRows(
      rowsOf({ ...OCR, state: 'needs-language-pack', language: 'fr-FR' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Do it myself in Windows Settings' }));
    expect(bridge.readingCalls).toEqual(['settings']);
  });
});
