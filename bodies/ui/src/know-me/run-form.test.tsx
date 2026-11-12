/** Tests for RunForm: one input per source, the PDF read and size-checked, and the progress rows. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KnowMeStatus, KnowSourceInfo } from '../shapes';
import { RunForm } from './run-form';

const SOURCES: KnowSourceInfo[] = [
  { name: 'GitHub', needs: 'username', label: 'Your GitHub username' },
  { name: 'LinkedIn PDF', needs: 'file', label: 'Your LinkedIn PDF' },
  { name: 'The web', needs: 'none', label: 'The web' },
];

function form(over: Partial<Parameters<typeof RunForm>[0]> = {}) {
  const onStart = vi.fn();
  render(<RunForm sources={SOURCES} onStart={onStart} running={false} {...over} />);
  return { onStart };
}

const pdf = (bytes: number | string, name = 'cv.pdf') =>
  new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name, {
    type: 'application/pdf',
  });
const choose = (file: File) =>
  fireEvent.change(screen.getByLabelText('Your LinkedIn PDF'), { target: { files: [file] } });

describe('RunForm', () => {
  it('renders one input per source from what it needs, and nothing for "none"', () => {
    form();
    expect(screen.getByLabelText('Your GitHub username')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Your LinkedIn PDF')).toHaveAttribute(
      'accept',
      '.pdf,application/pdf',
    );
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.queryByText('The web')).not.toBeInTheDocument();
  });

  it('keeps Start disabled until a username or a PDF is given', async () => {
    form();
    const start = screen.getByRole('button', { name: 'Get to know me' });
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your GitHub username'), { target: { value: '  ' } });
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your GitHub username'), { target: { value: 'octo' } });
    expect(start).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Your GitHub username'), { target: { value: '' } });
    choose(pdf('hello'));
    await waitFor(() => expect(start).toBeEnabled());
  });

  it('refuses a PDF over 10 MB with a plain line', () => {
    form();
    choose(pdf(10 * 1024 * 1024 + 1));
    expect(screen.getByRole('alert')).toHaveTextContent('That PDF is over 10 MB');
    expect(screen.getByRole('button', { name: 'Get to know me' })).toBeDisabled();
  });

  it('reads the file as base64 and passes it with the username', async () => {
    const { onStart } = form();
    fireEvent.change(screen.getByLabelText('Your GitHub username'), {
      target: { value: ' octo ' },
    });
    choose(pdf('hi'));
    const start = screen.getByRole('button', { name: 'Get to know me' });
    await waitFor(() => expect(screen.getByText('cv.pdf')).toBeInTheDocument());
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledWith({
      github: 'octo',
      pdf: { name: 'cv.pdf', data: 'aGk=' },
    });
  });

  it('says how to save the LinkedIn PDF', () => {
    form();
    expect(
      screen.getByText('On your LinkedIn profile: More, then Save to PDF.'),
    ).toBeInTheDocument();
  });

  it('follows the status with a row per source, including the portrait row', () => {
    const status: KnowMeStatus = {
      done: false,
      sources: [
        { name: 'GitHub', state: 'done' },
        { name: 'LinkedIn PDF', state: 'reading' },
        { name: 'The web', state: 'failed', gap: 'Nothing matched you.' },
        { name: 'portrait', state: 'waiting' },
      ],
    };
    form({ running: true, status });
    const rows = screen.getByRole('list', { name: 'Progress' });
    expect(rows).toHaveTextContent('GitHub: done');
    expect(rows).toHaveTextContent('Reading LinkedIn PDF…');
    expect(rows).toHaveTextContent('The web: not read');
    expect(rows).toHaveTextContent('Nothing matched you.');
    expect(rows).toHaveTextContent('Portrait: waiting');
    expect(screen.queryByLabelText('Your GitHub username')).not.toBeInTheDocument();
  });

  it('says so when the file cannot be read', async () => {
    form();
    class BrokenReader {
      onerror: (() => void) | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('FileReader', BrokenReader);
    try {
      choose(pdf('hi'));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not read that file.');
      expect(screen.getByRole('button', { name: 'Get to know me' })).toBeDisabled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows the start error as an alert', () => {
    form({ error: 'Scout is not connected right now.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Scout is not connected right now.');
  });
});
