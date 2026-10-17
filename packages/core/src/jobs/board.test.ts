/** Tests for the task board read model: items from each source, the rendered facts and ids. */
import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from '@tagalong/protocol';
import { boardItems, renderBoard, resolveId, type BoardSources } from './board';
import type { JobRow } from './store';

const NOW = new Date('2026-10-17T10:00:00.000Z');

function job(overrides: Partial<JobRow>): JobRow {
  return {
    id: '7f3a0000-0000-4000-8000-000000000001',
    state: 'running',
    petId: 'scout',
    task: 'read the agent-memory paper',
    dedupeKey: 'read the agent memory paper',
    conversationId: 'c1',
    note: null,
    error: null,
    createdAt: '2026-10-17T09:55:00.000Z',
    startedAt: '2026-10-17T09:56:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

function entry(overrides: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: '55e00000-0000-4000-8000-000000000009',
    kind: 'expert',
    state: 'error',
    petId: 'scout',
    startedAt: '2026-10-17T08:00:00.000Z',
    finishedAt: '2026-10-17T08:15:00.000Z',
    ...overrides,
  };
}

function sources(overrides: Partial<BoardSources> = {}): BoardSources {
  return {
    jobs: [],
    experts: [],
    pending: [],
    watches: [],
    routines: [],
    finished: [],
    ...overrides,
  };
}

describe('boardItems', () => {
  it('takes items from every source with their state and short id', () => {
    const items = boardItems(
      sources({
        jobs: [
          job({}),
          job({
            id: 'c2100000-0000-4000-8000-000000000002',
            state: 'queued',
            task: 'compare',
            startedAt: null,
          }),
          job({
            id: '1b2c0000-0000-4000-8000-000000000003',
            state: 'done',
            note: 'Friday it is.',
            finishedAt: '2026-10-17T09:40:00.000Z',
          }),
        ],
        experts: [
          {
            handoffId: '91ab0000-0000-4000-8000-000000000004',
            expertName: 'Claude Code',
            ask: 'fix the test',
          },
        ],
        pending: [{ expertName: 'Researcher', ask: 'papers on agent memory' }],
        watches: [
          {
            watchId: '3c4d0000-0000-4000-8000-000000000005',
            condition: 'the build finishes',
            checks: 12,
            maxChecks: 60,
          },
        ],
        routines: [{ routineId: 'r1', name: 'Morning papers' }],
        finished: [
          entry({
            text: 'fix dark mode\n\nWindow: secret stuff',
            expertName: 'Claude Code',
            error: 'tests did not pass',
          }),
          entry({
            id: 'aaaa0000-0000-4000-8000-000000000006',
            kind: 'routine',
            state: 'done',
            text: 'Morning papers',
            answer: 'Two new papers.\nMore.',
          }),
        ],
      }),
      NOW,
    );
    expect(items.map((item) => [item.id, item.kind, item.state])).toEqual([
      ['j-7f3a', 'job', 'running'],
      ['j-c210', 'job', 'queued'],
      ['h-91ab', 'expert', 'running'],
      ['w-3c4d', 'watch', 'running'],
      [undefined, 'routine', 'running'],
      [undefined, 'expert', 'waiting'],
      ['j-1b2c', 'job', 'done'],
      ['h-55e0', 'expert', 'error'],
      ['r-aaaa', 'routine', 'done'],
    ]);
    expect(items[6]).toMatchObject({ note: 'Friday it is.' });
    expect(items[7]).toMatchObject({
      title: 'Claude Code: fix dark mode',
      error: 'tests did not pass',
    });
    expect(renderBoard(items, NOW, { timeZone: 'UTC' })).toContain(
      '- h-55e0 Claude Code: fix dark mode, failed 08:15. Error: tests did not pass\n' +
        '- r-aaaa Routine Morning papers, done 08:15. Note: Two new papers.',
    );
    expect(renderBoard(items, NOW, { timeZone: 'UTC' })).toContain(
      '- j-1b2c your job, done 09:40: read the agent-memory paper. Note: Friday it is.',
    );
    expect(items[8]).toMatchObject({ title: 'Routine Morning papers', note: 'Two new papers.' });
    expect(items[3]).toMatchObject({ progress: '12 of 60 checks' });
  });

  it('leaves out work that finished more than a day ago, and hides secrets in titles', () => {
    const items = boardItems(
      sources({
        jobs: [
          job({ state: 'done', finishedAt: '2026-10-16T09:00:00.000Z' }),
          job({
            id: 'bbbb0000-0000-4000-8000-000000000007',
            task: 'use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
          }),
        ],
        finished: [entry({ finishedAt: '2026-10-16T08:00:00.000Z' })],
      }),
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.title).not.toContain('abcdefghijklmnop');
  });
});

describe('renderBoard', () => {
  it('says plainly when there is nothing', () => {
    expect(renderBoard([], NOW, { timeZone: 'UTC' })).toBe(
      'Nothing is running and nothing finished today.',
    );
  });

  it('has a section only when it has items, with durations and times', () => {
    const items = boardItems(
      sources({
        jobs: [
          job({}),
          job({
            id: '1b2c0000-0000-4000-8000-000000000003',
            state: 'done',
            note: 'Friday it is.',
            finishedAt: '2026-10-17T09:40:00.000Z',
          }),
        ],
      }),
      NOW,
    );
    expect(renderBoard(items, NOW, { timeZone: 'UTC' })).toBe(
      [
        'Working now:',
        '- j-7f3a your job, running (4 min): read the agent-memory paper',
        'Finished today:',
        '- j-1b2c your job, done 09:40: read the agent-memory paper. Note: Friday it is.',
      ].join('\n'),
    );
  });

  it('gives the job counts and why fewer run when the machine is busy', () => {
    const items = boardItems(
      sources({
        jobs: [
          job({}),
          job({
            id: 'c2100000-0000-4000-8000-000000000002',
            state: 'queued',
            task: 'compare',
            startedAt: null,
          }),
        ],
        pending: [{ expertName: 'Researcher', ask: 'papers' }],
      }),
      NOW,
    );
    const text = renderBoard(items, NOW, {
      timeZone: 'UTC',
      capacity: { slots: 1, busy: 'memory' },
    });
    expect(text).toContain('- j-c210 your job, waiting to start: compare');
    expect(text).toContain(
      'Your jobs: 1 running, 1 waiting. The machine is short of free memory, so 1 runs at a time now.',
    );
    expect(text).toContain('Waiting for their Send:\n- Researcher: papers');
  });
});

describe('resolveId', () => {
  const items = boardItems(
    sources({
      jobs: [
        job({ id: '1b2c9a00-0000-4000-8000-000000000001' }),
        job({ id: '1b2cff00-0000-4000-8000-000000000002' }),
        job({ id: '7f3a0000-0000-4000-8000-000000000003' }),
      ],
      watches: [
        {
          watchId: '7f3a1111-0000-4000-8000-000000000005',
          condition: 'x',
          checks: 0,
          maxChecks: 60,
        },
      ],
    }),
    NOW,
  );

  it('finds an item by its short id, its full id or more of it', () => {
    expect(resolveId(items, 'j-7f3a')).toMatchObject({
      ref: '7f3a0000-0000-4000-8000-000000000003',
    });
    expect(resolveId(items, ' W-7F3A ')).toMatchObject({ kind: 'watch' });
    expect(resolveId(items, '1b2cff00-0000-4000-8000-000000000002')).toMatchObject({ kind: 'job' });
    expect(resolveId(items, 'j-1b2c9a')).toMatchObject({
      ref: '1b2c9a00-0000-4000-8000-000000000001',
    });
  });

  it('reports two matches as ambiguous and an unknown id as null', () => {
    const result = resolveId(items, 'j-1b2c');
    expect(result).not.toBeNull();
    expect(result !== null && 'ambiguous' in result ? result.ambiguous.length : 0).toBe(2);
    expect(resolveId(items, 'j-zz00')).toBeNull();
    expect(resolveId(items, '')).toBeNull();
  });
});
