/** Tests for CheckFacts: what the check card says about who made it, where it runs and its code. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppRow } from '../shapes';
import { CheckFacts } from './check-facts';

const ROW: AppRow = {
  id: 'io.github.acme-dev/linear',
  name: 'Linear',
  version: '1',
  description: 'd',
  official: false,
  publisher: 'acme-dev',
  runs: 'pc',
  host: null,
  signIn: 'key',
  licence: 'MIT',
  repo: 'https://github.com/acme-dev/linear',
  added: false,
};

describe('CheckFacts', () => {
  it('an app says who made it (not the service), where it runs, its licence and that nobody checked', () => {
    render(<CheckFacts row={ROW} />);
    expect(screen.getByText('Made by acme-dev, not Linear')).toBeTruthy();
    expect(screen.getByText('Runs on your PC · Licence MIT')).toBeTruthy();
    expect(screen.getByText('Nobody has checked this one yet')).toBeTruthy();
  });

  it('leaves the licence out when the registry has none, never printing Unknown', () => {
    const { container } = render(<CheckFacts row={{ ...ROW, licence: 'Unknown' }} />);
    expect(screen.getByText('Runs on your PC')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Unknown|Licence/);
    render(<CheckFacts row={{ ...ROW, licence: '' }} />);
    expect(screen.getAllByText('Runs on your PC')).toHaveLength(2);
  });

  it('a hosted app is said to run on the web', () => {
    render(<CheckFacts row={{ ...ROW, runs: 'hosted', host: 'mcp.acme.dev' }} />);
    expect(screen.getByText('Runs on the web · Licence MIT')).toBeTruthy();
  });

  it('expert check never says Unknown: one line on what the list does not say', () => {
    const { container } = render(<CheckFacts row={{ name: 'Kimi CLI' }} />);
    expect(screen.getByText("The expert list doesn't say who made this or check it.")).toBeTruthy();
    expect(screen.getByText('Runs on your PC')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Unknown|Nobody has checked|Made by/);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('an expert says its licence and links its code when the list has them', () => {
    const { container } = render(
      <CheckFacts
        row={{ name: 'Kimi CLI', licence: 'Apache-2.0', repo: 'https://github.com/x/kimi' }}
      />,
    );
    expect(screen.getByText('Runs on your PC · Licence Apache-2.0')).toBeTruthy();
    expect(screen.getByRole('link', { name: /See its code/ }).getAttribute('href')).toBe(
      'https://github.com/x/kimi',
    );
    expect(container.textContent).not.toMatch(/Unknown/);
  });

  it('an expert with an unsafe code address shows no link', () => {
    render(<CheckFacts row={{ name: 'Kimi CLI', repo: 'javascript:alert(1)' }} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('See its code is a safe new-tab link, absent without a web address', () => {
    const { unmount } = render(<CheckFacts row={ROW} />);
    const link = screen.getByRole('link', { name: /See its code/ });
    expect(link.getAttribute('href')).toBe(ROW.repo);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer noopener');
    unmount();
    render(<CheckFacts row={{ ...ROW, repo: '' }} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it.each(['javascript:alert(1)', 'file:///c:/secret', 'ftp://x.example/y', 'not a url'])(
    'shows no code link for a repo that is not http(s): %s',
    (repo) => {
      render(<CheckFacts row={{ ...ROW, repo }} />);
      expect(screen.queryByRole('link')).toBeNull();
    },
  );
});
