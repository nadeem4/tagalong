/** Tests for UpdatesBar and the row pieces: the header, the group switches, a row's update words. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateRow, UpdatesState } from '../shapes';
import { UpdateSide, UpdatesBar, updateMeta, type UpdatesControls } from './updates-bar';

const NOW = Date.parse('2026-11-10T12:00:00+00:00');
const row = (over: Partial<UpdateRow> = {}): UpdateRow => ({
  kind: 'app',
  id: 'github',
  name: 'GitHub',
  installed: '0.9',
  latest: '1.0',
  remote: false,
  official: true,
  auto: true,
  status: 'idle',
  ...over,
});
const state = (items: UpdateRow[], checkedAt: string | null = '2026-11-10T11:55:00+00:00') =>
  ({
    checkedAt,
    auto: {
      apps: { official: true, community: false },
      experts: { official: true, community: false },
    },
    items,
  }) satisfies UpdatesState;

function controls(items: UpdateRow[], checkedAt?: string | null): UpdatesControls {
  return {
    state: state(items, checkedAt),
    checking: false,
    onCheck: vi.fn(),
    onUpdate: vi.fn(),
    onUpdateAll: vi.fn(),
    onAuto: vi.fn(),
  };
}

describe('UpdatesBar', () => {
  it('shows Checked N minutes ago and Check for updates', () => {
    const c = controls([]);
    render(<UpdatesBar title="Your apps" kind="app" controls={c} now={NOW} />);
    expect(screen.getByText('Checked 5 minutes ago')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(c.onCheck).toHaveBeenCalled();
  });

  it('says so when it has never checked', () => {
    render(<UpdatesBar title="Your apps" kind="app" controls={controls([], null)} now={NOW} />);
    expect(screen.getByText('Not checked yet')).toBeVisible();
  });

  it('shows Update all (n) only when n is above zero', () => {
    const c = controls([row(), row({ id: 'b' }), row({ id: 'c', latest: null })]);
    const { rerender } = render(<UpdatesBar title="Your apps" kind="app" controls={c} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update all (2)' }));
    expect(c.onUpdateAll).toHaveBeenCalledWith('app');
    rerender(
      <UpdatesBar
        title="Your apps"
        kind="app"
        controls={controls([row({ latest: null })])}
        now={NOW}
      />,
    );
    expect(screen.queryByRole('button', { name: /Update all/ })).toBeNull();
  });

  it('has one automatic switch per group, Official on and Community off at first', () => {
    const c = controls([]);
    render(<UpdatesBar title="Your apps" kind="app" controls={c} now={NOW} />);
    const official = screen.getByRole('switch', {
      name: 'Keep Official apps up to date automatically',
    });
    const community = screen.getByRole('switch', {
      name: 'Keep Community apps up to date automatically',
    });
    expect(official).toHaveAttribute('aria-checked', 'true');
    expect(community).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.getByText('Off at first. Updates to code nobody has reviewed wait for you.'),
    ).toBeVisible();
    fireEvent.click(community);
    expect(c.onAuto).toHaveBeenCalledWith('app', false, true);
  });

  it('words the experts tab for experts', () => {
    render(<UpdatesBar title="Your experts" kind="expert" controls={controls([])} now={NOW} />);
    expect(
      screen.getByRole('switch', { name: 'Keep Official experts up to date automatically' }),
    ).toBeVisible();
  });
});

describe('updateMeta', () => {
  it('shows v1.2 → v1.3 when there is a newer one', () => {
    expect(updateMeta(row({ installed: '1.2', latest: '1.3' }))).toBe('v1.2 → v1.3');
  });
  it('shows just the version when up to date, and nothing when none is known', () => {
    expect(updateMeta(row({ latest: null }))).toBe('v0.9');
    expect(updateMeta(row({ latest: null, installed: '' }))).toBeNull();
  });
  it('says Always up to date for a remote app', () => {
    expect(updateMeta(row({ remote: true, installed: '', latest: null }))).toBe(
      'Always up to date',
    );
  });
  it('says Waits for you when the group is not automatic', () => {
    expect(updateMeta(row({ auto: false, official: false }))).toBe('v0.9 → v1.0 · Waits for you');
  });
});

describe('UpdateSide', () => {
  const side = (r: UpdateRow, onUpdate = vi.fn()) => {
    render(<UpdateSide row={r} onUpdate={onUpdate} />);
    return onUpdate;
  };

  it('offers Update, and pressing it asks for that one', () => {
    const onUpdate = side(row());
    fireEvent.click(screen.getByRole('button', { name: 'Update GitHub' }));
    expect(onUpdate).toHaveBeenCalled();
  });
  it('says Updating… while it runs', () => {
    side(row({ status: 'updating' }));
    expect(screen.getByText('Updating…')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('says it is waiting for a job when one is running', () => {
    side(row({ status: 'waiting' }));
    expect(screen.getByText('Waiting for a job to finish…')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('says Updated to vX. after', () => {
    side(row({ status: 'updated', installed: '1.0', latest: null }));
    expect(screen.getByText('Updated to v1.0.')).toBeVisible();
  });
  it('says it did not work and keeps the button', () => {
    side(row({ status: 'failed', error: 'x' }));
    expect(screen.getByText('The update didn’t work.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Update GitHub' })).toBeVisible();
  });
  it('has no controls on a remote app', () => {
    side(row({ remote: true, latest: null, installed: '' }));
    expect(screen.queryByRole('button')).toBeNull();
  });
});
