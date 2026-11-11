/**
 * Tests for InstallCard: one state each (Allow, community Allow, working, done, failed, and the
 * expert's downloading, sign in and ready), the wording of the mockup, and subjectOf.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { INSTALL_CARD_CSS, InstallCard, subjectOf, type InstallSubject } from './install-card';
import { ruleOf } from '../test-support/css-rules';

const NOTION: InstallSubject = {
  kind: 'app',
  id: 'notion',
  name: 'Notion',
  official: true,
  madeBy: 'Notion',
  runs: 'hosted',
  signIn: 'browser',
};
const VAULT: InstallSubject = {
  kind: 'app',
  id: 'vaultkit',
  name: 'Vaultkit',
  official: false,
  madeBy: 'vaultkit',
  runs: 'pc',
  signIn: 'none',
  licence: 'MIT',
  repo: 'https://github.com/vaultkit/vaultkit',
};
const CLAUDE: InstallSubject = {
  kind: 'expert',
  id: 'claude-acp',
  name: 'Claude Code',
  official: true,
  recommended: true,
  madeBy: 'Anthropic',
  runs: 'pc',
  signIn: 'account',
};

const card = (name: string) => screen.getByRole('group', { name: `Set up ${name}` });

describe('InstallCard ask', () => {
  it('Allow: name, Official chip, who made it, where it runs and how it signs in', () => {
    const onAllow = vi.fn();
    const onNotNow = vi.fn();
    render(
      <InstallCard
        subject={NOTION}
        view={{ phase: 'ask' }}
        onAllow={onAllow}
        onNotNow={onNotNow}
      />,
    );
    expect(card('Notion')).toHaveTextContent('Official');
    expect(card('Notion')).toHaveTextContent('Made by Notion · Runs on the web · Browser sign-in');
    expect(card('Notion')).toHaveTextContent('It asks before changing anything.');
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onAllow).toHaveBeenCalledOnce();
    expect(onNotNow).toHaveBeenCalledOnce();
  });

  it('community: Check first with the facts, and Allow anyway', () => {
    render(<InstallCard subject={VAULT} view={{ phase: 'ask' }} />);
    expect(card('Vaultkit')).toHaveTextContent('Community');
    expect(card('Vaultkit')).toHaveTextContent('By vaultkit · Runs on your PC');
    expect(card('Vaultkit')).toHaveTextContent('Check first');
    expect(card('Vaultkit')).toHaveTextContent(
      "The app list doesn't say who made this or check it.",
    );
    expect(card('Vaultkit')).toHaveTextContent('Runs on your PC · Licence MIT');
    expect(screen.getByRole('link', { name: /See its code/ })).toHaveAttribute(
      'href',
      'https://github.com/vaultkit/vaultkit',
    );
    expect(screen.getByRole('button', { name: 'Allow anyway' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });

  it('an expert shows Official and Recommended and its own-account line', () => {
    render(<InstallCard subject={CLAUDE} view={{ phase: 'ask' }} />);
    expect(card('Claude Code')).toHaveTextContent('Official');
    expect(card('Claude Code')).toHaveTextContent('Recommended');
    expect(card('Claude Code')).toHaveTextContent(
      'Made by Anthropic · Runs on your PC · Your own account',
    );
  });
});

describe('InstallCard working', () => {
  it('shows the steps with their state, the bar and the sign-in note', () => {
    render(
      <InstallCard
        subject={NOTION}
        view={{
          phase: 'working',
          steps: [
            { label: 'Checking it', state: 'done' },
            { label: 'Connecting', state: 'done' },
            { label: 'Signing in', state: 'now' },
          ],
          percent: 70,
          note: 'Your browser opened to sign in.',
        }}
      />,
    );
    const steps = screen.getByRole('list', { name: 'Steps' });
    expect(steps).toHaveTextContent('Checking it');
    expect(steps.querySelector('li.is-now')).toHaveTextContent('Signing in');
    expect(steps.querySelectorAll('li.is-done')).toHaveLength(2);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '70');
    expect(card('Notion')).toHaveTextContent('Your browser opened to sign in.');
  });

  it('an expert download shows the percent and where it goes', () => {
    render(
      <InstallCard
        subject={CLAUDE}
        view={{
          phase: 'working',
          label: 'Downloading…',
          percent: 40,
          note: 'Into Tagalong’s own folder.',
        }}
      />,
    );
    expect(card('Claude Code')).toHaveTextContent('Downloading…');
    expect(card('Claude Code')).toHaveTextContent('40%');
    expect(card('Claude Code')).toHaveTextContent('Into Tagalong’s own folder.');
  });
});

describe('InstallCard done and sign in', () => {
  it('done: Connected, the line, the folded tools and Manage in Connections', () => {
    const onManage = vi.fn();
    render(
      <InstallCard
        subject={NOTION}
        view={{ phase: 'done', tools: ['search', 'create_page'] }}
        onManage={onManage}
      />,
    );
    expect(card('Notion')).toHaveTextContent('Connected');
    expect(card('Notion')).toHaveTextContent('Notion is ready.');
    expect(screen.getByText('2 things Scout can do')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Manage in Connections' }));
    expect(onManage).toHaveBeenCalledOnce();
  });

  it('done offers the try-asking prompts when given', () => {
    const onTry = vi.fn();
    render(
      <InstallCard
        subject={CLAUDE}
        view={{ phase: 'done', tryPrompts: ['Fix the failing test'] }}
        onTry={onTry}
      />,
    );
    expect(card('Claude Code')).toHaveTextContent('Ready');
    expect(card('Claude Code')).toHaveTextContent('Claude Code is ready.');
    fireEvent.click(screen.getByRole('button', { name: 'Fix the failing test' }));
    expect(onTry).toHaveBeenCalledWith('Fix the failing test');
  });

  it('sign in: Later and Sign in', () => {
    const onSignIn = vi.fn();
    const onLater = vi.fn();
    render(
      <InstallCard
        subject={CLAUDE}
        view={{ phase: 'signin' }}
        onSignIn={onSignIn}
        onLater={onLater}
      />,
    );
    expect(card('Claude Code')).toHaveTextContent(
      'Installed. Sign in once with your own Claude account; Scout never sees your password.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(onSignIn).toHaveBeenCalledOnce();
    expect(onLater).toHaveBeenCalledOnce();
  });
});

describe('InstallCard failed', () => {
  it('keeps Try again and Not now, marks the failed step and says nothing was connected', () => {
    const onRetry = vi.fn();
    const onNotNow = vi.fn();
    render(
      <InstallCard
        subject={NOTION}
        view={{
          phase: 'failed',
          error: "Notion didn't finish signing in. Nothing was connected.",
          steps: [
            { label: 'Checking it', state: 'done' },
            { label: 'Connecting', state: 'done' },
            { label: 'Signing in', state: 'fail' },
          ],
        }}
        onRetry={onRetry}
        onNotNow={onNotNow}
      />,
    );
    expect(
      screen.getByRole('list', { name: 'Steps' }).querySelector('li.is-fail'),
    ).toHaveTextContent('Signing in');
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing was connected.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onNotNow).toHaveBeenCalledOnce();
  });
});

describe('InstallCard as the mockup draws it', () => {
  const steps = (at: number) =>
    ['Checking it', 'Connecting', 'Signing in'].map((label, i) => ({
      label,
      state: i < at ? ('done' as const) : i === at ? ('now' as const) : ('todo' as const),
    }));

  it('working with steps but no percent draws a bar from the steps done', () => {
    render(<InstallCard subject={NOTION} view={{ phase: 'working', steps: steps(2) }} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67');
  });

  it('the first step shows a small bar, not an empty one', () => {
    render(<InstallCard subject={NOTION} view={{ phase: 'working', steps: steps(0) }} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');
  });

  it('an expert Ready has no Manage in Connections, an app Done does', () => {
    const { rerender } = render(
      <InstallCard subject={CLAUDE} view={{ phase: 'done' }} onManage={() => undefined} />,
    );
    expect(screen.queryByRole('button', { name: /Manage in Connections/ })).toBeNull();
    rerender(<InstallCard subject={NOTION} view={{ phase: 'done' }} onManage={() => undefined} />);
    expect(screen.getByRole('button', { name: /Manage in Connections/ })).toBeVisible();
  });

  it('community check has an alert icon and a gold external See its code link', () => {
    render(<InstallCard subject={VAULT} view={{ phase: 'ask' }} />);
    expect(card('Vaultkit').querySelector('.sc-check-t svg')).not.toBeNull();
    const link = screen.getByRole('link', { name: 'See its code' });
    expect(link.querySelector('svg')).not.toBeNull();
    expect(link).toHaveClass('sc-link--gold');
  });

  it('the failure words sit in a box with an error icon', () => {
    render(
      <InstallCard
        subject={NOTION}
        view={{ phase: 'failed', error: "Notion didn't finish signing in. Nothing was connected." }}
      />,
    );
    expect(screen.getByRole('alert').querySelector('svg')).not.toBeNull();
  });

  it('the things Scout can do fold behind a chevron', () => {
    render(<InstallCard subject={NOTION} view={{ phase: 'done', tools: ['search'] }} />);
    expect(card('Notion').querySelector('.sc-disc summary svg')).not.toBeNull();
  });
});

describe('subjectOf', () => {
  it('reads the recommended flag of an expert ask', () => {
    expect(subjectOf('install_expert', { expert: 'claude-acp', recommended: true })).toMatchObject({
      recommended: true,
    });
    expect(subjectOf('install_expert', { expert: 'other' }).recommended).toBeUndefined();
  });

  it('reads an app ask: who made it, where it runs, how it signs in', () => {
    expect(
      subjectOf('install_app', {
        app: 'app.notion/mcp',
        official: true,
        publisher: 'Notion',
        runs: 'hosted',
        sign_in: 'browser',
        licence: 'MIT',
        repo: 'https://x',
      }),
    ).toMatchObject({
      kind: 'app',
      id: 'app.notion/mcp',
      name: 'Notion',
      official: true,
      madeBy: 'Notion',
      runs: 'hosted',
      signIn: 'browser',
    });
  });

  it('reads an expert ask', () => {
    expect(subjectOf('install_expert', { expert: 'claude-acp' })).toMatchObject({
      kind: 'expert',
      id: 'claude-acp',
      name: 'Claude',
      signIn: 'account',
      runs: 'pc',
    });
  });
});

describe('INSTALL_CARD_CSS', () => {
  it('keeps the bullets of its lists visible whatever the page resets', () => {
    expect(ruleOf(INSTALL_CARD_CSS, '.sc-check ul')).toContain('list-style: disc');
    expect(ruleOf(INSTALL_CARD_CSS, '.sc-disc ul')).toContain('list-style: disc');
  });
});
