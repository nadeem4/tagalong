/** Tests for RunForm: one input per source, the PDF read and size-checked, and the progress rows. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KnowMeStatus, KnowSourceInfo } from '../shapes';
import { RunForm } from './run-form';

const SOURCES: KnowSourceInfo[] = [
  { name: 'github', needs: 'username', label: 'GitHub' },
  { name: 'linkedin', needs: 'file', label: 'LinkedIn PDF' },
  { name: 'web', needs: 'none', label: 'The web' },
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
  fireEvent.change(screen.getByLabelText('LinkedIn PDF'), { target: { files: [file] } });

describe('RunForm', () => {
  it('renders one input per source from what it needs, and nothing for "none"', () => {
    form();
    expect(screen.getByLabelText('GitHub')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('LinkedIn PDF')).toHaveAttribute('accept', '.pdf,application/pdf');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.queryByText('The web')).not.toBeInTheDocument();
  });

  it('keeps Start disabled until a username or a PDF is given', async () => {
    form();
    const start = screen.getByRole('button', { name: 'Get to know me' });
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText('GitHub'), { target: { value: '  ' } });
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText('GitHub'), { target: { value: 'octo' } });
    expect(start).toBeEnabled();
    fireEvent.change(screen.getByLabelText('GitHub'), { target: { value: '' } });
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
    fireEvent.change(screen.getByLabelText('GitHub'), {
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

  it('shows the source label, not the brain name, in the progress rows', () => {
    const sources: KnowSourceInfo[] = [
      { name: 'github', needs: 'username', label: 'GitHub' },
      { name: 'linkedin', needs: 'file', label: 'LinkedIn PDF' },
      { name: 'web', needs: 'none', label: 'The web' },
    ];
    const status: KnowMeStatus = {
      done: false,
      sources: [
        { name: 'github', state: 'reading' },
        { name: 'linkedin', state: 'done' },
        { name: 'web', state: 'failed' },
        { name: 'portrait', state: 'waiting' },
      ],
    };
    form({ running: true, status, sources });
    const rows = screen.getByRole('list', { name: 'Progress' });
    expect(rows).toHaveTextContent('Reading GitHub…');
    expect(rows).toHaveTextContent('LinkedIn PDF: done');
    expect(rows).toHaveTextContent('The web: not read');
    expect(rows).not.toHaveTextContent('github');
    expect(rows).toHaveTextContent('Portrait: waiting');
  });

  it('follows the status with a row per source, including the portrait row', () => {
    const status: KnowMeStatus = {
      done: false,
      sources: [
        { name: 'github', state: 'done' },
        { name: 'linkedin', state: 'reading' },
        { name: 'web', state: 'failed', gap: 'Nothing matched you.' },
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
    expect(screen.queryByLabelText('GitHub')).not.toBeInTheDocument();
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
