/** Tests for the restart decision: one case per rule, and the two review-focus guarantees. */
import { describe, expect, it } from 'vitest';
import { decideUpdate } from './version-check';

const ours = { version: '0.9.2', build: 'a1b2c3d4e5f6' };
const facts = { startedBy: 'desktop' as const, workRunning: false, restartedThisRun: false };

describe('decideUpdate', () => {
  it('equal version and build is current', () => {
    expect(decideUpdate(ours, { ...ours }, facts)).toBe('current');
  });

  it('a different build restarts quietly when nothing runs', () => {
    expect(decideUpdate(ours, { version: '0.9.2', build: 'old' }, facts)).toBe('restart');
  });

  it('a different version restarts quietly when nothing runs', () => {
    expect(decideUpdate(ours, { version: '0.9.1', build: ours.build }, facts)).toBe('restart');
  });

  it('asks while work is running', () => {
    const theirs = { version: '0.9.1', build: 'x' };
    expect(decideUpdate(ours, theirs, { ...facts, workRunning: true })).toBe('ask');
  });

  it('a person-started brain is never restarted', () => {
    const theirs = { version: '0.9.1', build: 'x' };
    expect(decideUpdate(ours, theirs, { ...facts, startedBy: 'person' })).toBe('terminal');
  });

  it('an old brain with no brain_status asks', () => {
    const theirs = { version: '0.9.1', build: 'x' };
    expect(decideUpdate(ours, theirs, { ...facts, startedBy: null })).toBe('ask');
  });

  it('an old brain with no version is never current', () => {
    expect(decideUpdate(ours, {}, { ...facts, startedBy: null })).toBe('ask');
    expect(decideUpdate(ours, {}, facts)).not.toBe('current');
  });

  it('a second mismatch in the same run asks instead of restarting', () => {
    const theirs = { version: '0.9.2', build: 'old' };
    expect(decideUpdate(ours, theirs, { ...facts, restartedThisRun: true })).toBe('ask');
  });
});
