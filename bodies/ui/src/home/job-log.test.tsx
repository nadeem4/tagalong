/**
 * Tests for JobLog: each kind of step in the read-only log, the running timer and its note,
 * the status glyphs, ANSI colours, and the log's accessibility roles.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { JobActivityEntry } from '../host-bridge';
import { JobLog } from './job-log';

const NOW = Date.parse('2026-11-02T10:00:20.000Z');
const entry = (seq: number, extra: Partial<JobActivityEntry>): JobActivityEntry => ({
  rev: seq,
  seq,
  at: '2026-11-02T10:00:06.000Z',
  kind: 'command',
  text: '',
  status: null,
  step: null,
  exit: null,
  part: 'p1',
  source: null,
  ...extra,
});

describe('JobLog', () => {
  it('is a focusable log that does not announce every line', () => {
    render(<JobLog entries={[]} now={NOW} />);
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('tabindex', '0');
    expect(log).toHaveAttribute('aria-live', 'off');
  });

  it('shows a finished command with a done glyph and its output', () => {
    render(
      <JobLog
        entries={[
          entry(1, { text: 'npm test', status: 'done', step: 's1' }),
          entry(2, { kind: 'output', text: 'all green', step: 's1' }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByText('$ npm test')).toBeInTheDocument();
    expect(screen.getByLabelText('done')).toBeInTheDocument();
    expect(screen.getByText('all green')).toBeInTheDocument();
  });

  it('gives stopped and refused steps their own glyphs, not the waiting dot', () => {
    render(
      <JobLog
        entries={[
          entry(1, { text: 'sleep 600', status: 'stopped', step: 's1' }),
          entry(2, { text: 'rm x', status: 'refused', step: 's2' }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByLabelText('stopped')).toHaveTextContent('■');
    expect(screen.getByLabelText('refused')).toHaveTextContent('⊘');
  });

  it('shows the elapsed time and a note for a running command with no output', () => {
    render(
      <JobLog
        entries={[entry(1, { text: 'pnpm build', status: 'running', step: 's1' })]}
        now={NOW}
      />,
    );
    expect(screen.getByText('running, 14 s')).toBeInTheDocument();
    expect(screen.getByText('output appears when the command finishes')).toBeInTheDocument();
  });

  it('drops the note once the step has output', () => {
    render(
      <JobLog
        entries={[
          entry(1, { text: 'pnpm build', status: 'running', step: 's1' }),
          entry(2, { kind: 'output', text: 'compiling', step: 's1' }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.queryByText('output appears when the command finishes')).toBeNull();
  });

  it('marks a failed step', () => {
    render(
      <JobLog entries={[entry(1, { text: 'make', status: 'failed', step: 's1' })]} now={NOW} />,
    );
    expect(screen.getByLabelText('failed')).toBeInTheDocument();
  });

  it('prefixes what the expert says with a hash', () => {
    render(
      <JobLog
        entries={[entry(1, { kind: 'say', text: 'Looking at the tests.\nThen fixing.' })]}
        now={NOW}
      />,
    );
    expect(screen.getByText('# Looking at the tests.')).toBeInTheDocument();
    expect(screen.getByText('# Then fixing.')).toBeInTheDocument();
  });

  it('draws a plan as checkbox lines', () => {
    render(
      <JobLog entries={[entry(1, { kind: 'plan', text: '[x] write test\n[ ] fix' })]} now={NOW} />,
    );
    expect(screen.getByText(/\[x\] write test/)).toBeInTheDocument();
    expect(screen.getByText(/\[ \] fix/)).toBeInTheDocument();
  });

  it('shows edits, reads, the dropped marker and the end line', () => {
    render(
      <JobLog
        entries={[
          entry(0, { kind: 'other', text: '[older steps dropped]' }),
          entry(1, { kind: 'edit', text: 'src/a.ts', status: 'done', step: 'e' }),
          entry(2, { kind: 'read', text: 'src/b.ts', status: 'done', step: 'r' }),
          entry(3, { kind: 'end', text: '# done' }),
        ]}
        now={NOW}
      />,
    );
    for (const text of ['[older steps dropped]', 'src/a.ts', 'src/b.ts', '# done']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it('colours ANSI output and collapses progress lines', () => {
    render(
      <JobLog
        entries={[entry(1, { kind: 'output', text: '\x1b[31mbad\x1b[0m\n10%\r100%', step: 's1' })]}
        now={NOW}
      />,
    );
    expect(screen.getByText('bad')).toHaveClass('ansi-red');
    expect(screen.queryByText(/10%/)).toBeNull();
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it('shows the exit code beside a command: ok for 0, error otherwise', () => {
    render(
      <JobLog
        entries={[
          entry(1, { text: 'ok cmd', status: 'done', exit: 0, step: 'a' }),
          entry(2, { text: 'bad cmd', status: 'failed', exit: 2, step: 'b' }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByText('exit 0')).toHaveClass('job-log__exit', 'job-log__exit--ok');
    expect(screen.getByText('exit 2')).toHaveClass('job-log__exit', 'job-log__exit--err');
    expect(screen.getByRole('img', { name: 'done' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'failed' })).toBeInTheDocument();
  });

  it('shows only the glyph when there is no exit code', () => {
    render(
      <JobLog
        entries={[
          entry(1, { text: 'killed', status: 'failed', exit: null, step: 'a' }),
          entry(2, { text: 'plain', status: 'done', exit: null, step: 'b' }),
          entry(3, { text: 'busy', status: 'running', exit: null, step: 'c' }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.queryByText(/^exit /)).toBeNull();
    expect(screen.getByRole('img', { name: 'failed' })).toBeInTheDocument();
  });
});
