/** Tests for FactsLine: the short meta line under an app or expert, built from the brain's facts. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppRow } from '../shapes';
import { FactsLine } from './facts-line';

const ROW: AppRow = {
  id: 'app.linear/linear',
  name: 'Linear',
  version: '1',
  description: 'd',
  official: true,
  publisher: 'linear.app',
  runs: 'hosted',
  host: 'mcp.linear.app',
  signIn: 'browser',
  licence: '',
  repo: '',
};

describe('FactsLine', () => {
  it('says a hosted app runs on the web and signs in in the browser', () => {
    render(<FactsLine row={ROW} />);
    expect(screen.getByText('Runs on the web · Browser sign-in')).toBeTruthy();
  });

  it('says a PC app runs on your PC, with the key it needs', () => {
    render(<FactsLine row={{ ...ROW, runs: 'pc', host: null, signIn: 'key' }} />);
    expect(screen.getByText('Runs on your PC · Key you paste')).toBeTruthy();
  });

  it('says No sign-in when nothing is needed', () => {
    render(<FactsLine row={{ ...ROW, runs: 'pc', signIn: 'none' }} />);
    expect(screen.getByText('Runs on your PC · No sign-in')).toBeTruthy();
  });

  it('never says who made it, even for a community app', () => {
    render(<FactsLine row={{ ...ROW, official: false, publisher: 'acme-dev' }} />);
    expect(screen.queryByText(/acme-dev|Made by/)).toBeNull();
  });

  it('leaves out where it runs when the brain does not know', () => {
    render(<FactsLine row={{ ...ROW, runs: null }} />);
    expect(screen.getByText('Browser sign-in')).toBeTruthy();
  });

  it('an expert runs on your PC and may sign in with your own account', () => {
    const { unmount } = render(<FactsLine row={{ runs: 'pc', account: true }} />);
    expect(screen.getByText('Runs on your PC · Signs in with your own account')).toBeTruthy();
    unmount();
    render(<FactsLine row={{ runs: 'pc', account: false }} />);
    expect(screen.getByText('Runs on your PC')).toBeTruthy();
  });
});
