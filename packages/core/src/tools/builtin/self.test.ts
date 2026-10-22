/** Tests for self_read and self_write: the pages, a bad input, a refused write, the turn ref. */
import { describe, expect, it } from 'vitest';
import type { SelfWriteResult } from '../../self/store';
import { fakeTurnTools } from '../fake-turn';
import { directivesIn } from '../test-support';
import { SELF_READ, SELF_WRITE, type SelfToolDeps } from './self';

function fakeSelf(pages: Record<string, string> = {}) {
  const writes: Array<{ path: string; text: string; why: string; ref?: string | undefined }> = [];
  const deps: SelfToolDeps = {
    list: () =>
      Object.entries({ 'you.md': '', 'lessons.md': '', 'commitments.md': '', ...pages }).map(
        ([path, text]) => ({ path, chars: text.length, proposals: 0 }),
      ),
    read: (path) => (path in pages ? pages[path]! : path.endsWith('.md') ? '' : null),
    write: (path, text, by): SelfWriteResult => {
      if (path === 'soul.md') return { ok: false, reason: 'soul.md is not a page.' };
      writes.push({ path, text, why: by.why, ref: by.ref });
      const proposed = path !== 'you.md' && path !== 'commitments.md';
      if (!proposed) pages[path] = text;
      return { ok: true, versionId: writes.length, proposed, clipped: false };
    },
  };
  return { deps, writes };
}

describe('self_read', () => {
  it('lists the pages with their sizes when no page is named', async () => {
    const { deps } = fakeSelf({ 'skills/triage.md': 'Read the first error.' });
    const outcome = await fakeTurnTools({ self: deps }).run({ name: SELF_READ, input: {} });
    expect(outcome.isError).toBeUndefined();
    expect(outcome.content).toContain('you.md (empty)');
    expect(outcome.content).toContain('skills/triage.md (21 characters)');
    expect(directivesIn(outcome.content)).toEqual([]);
  });

  it('reads one page, and says so when it is empty or not a page', async () => {
    const { deps } = fakeSelf({ 'lessons.md': 'Lead with the gist.' });
    const tools = fakeTurnTools({ self: deps });
    expect((await tools.run({ name: SELF_READ, input: { path: 'lessons.md' } })).content).toBe(
      'Lead with the gist.',
    );
    expect((await tools.run({ name: SELF_READ, input: { path: 'you.md' } })).content).toBe(
      'you.md is empty.',
    );
    const bad = await tools.run({ name: SELF_READ, input: { path: '../x' } });
    expect(bad.isError).toBe(true);
    expect(directivesIn(bad.content)).toEqual([]);
  });
});

describe('self_write', () => {
  it('replaces a page as Scout, with its reason and the turn it came from', async () => {
    const { deps, writes } = fakeSelf();
    const outcome = await fakeTurnTools({ self: deps }).run({
      name: SELF_WRITE,
      input: { path: 'you.md', text: 'Works on Tagalong.', why: 'They told me.' },
    });
    expect(outcome.isError).toBeUndefined();
    expect(outcome.content).toBe('Saved you.md (18 characters).');
    expect(writes).toEqual([
      { path: 'you.md', text: 'Works on Tagalong.', why: 'They told me.', ref: 'turn-1' },
    ]);
    expect(directivesIn(outcome.content)).toEqual([]);
  });

  it('says a change to lessons.md or a skill is a proposal they decide on, not saved', async () => {
    const { deps } = fakeSelf();
    const outcome = await fakeTurnTools({ self: deps }).run({
      name: SELF_WRITE,
      input: { path: 'lessons.md', text: 'Lead with the gist.', why: 'They corrected me.' },
    });
    expect(outcome.isError).toBeUndefined();
    expect(outcome.content).toMatch(/^Proposed lessons\.md\b/);
    expect(outcome.content).toContain('What Scout learned');
    expect(outcome.content).not.toContain('Saved');
    expect(directivesIn(outcome.content)).toEqual([]);
  });

  it('answers a missing field or a refused write as an error, without throwing', async () => {
    const { deps } = fakeSelf();
    const tools = fakeTurnTools({ self: deps });
    const missing = await tools.run({ name: SELF_WRITE, input: { path: 'you.md' } });
    expect(missing.isError).toBe(true);
    const refused = await tools.run({
      name: SELF_WRITE,
      input: { path: 'soul.md', text: 'x', why: 'y' },
    });
    expect(refused).toEqual({ content: 'soul.md is not a page.', isError: true });
  });
});
