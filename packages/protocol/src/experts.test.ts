import { describe, expect, it } from 'vitest';
import {
  Brief,
  Expert,
  HandoffFinishedParams,
  HandoffProposedParams,
  HandoffsConfirmParams,
  ProjectsSearchResult,
} from './experts';

const claudeCode = {
  id: 'claude-code',
  name: 'Claude Code',
  goodAt: 'Code changes in this repo',
  connection: { type: 'claude-code', folder: 'C:\\projects\\ai_pet' },
};

describe('Expert', () => {
  it('fills the defaults: on, read-only, no standing instructions, no web search', () => {
    expect(Expert.parse(claudeCode)).toEqual({
      ...claudeCode,
      enabled: true,
      instructions: '',
      connection: { ...claudeCode.connection, canEdit: false, canSearchWeb: false },
    });
  });

  it('keeps standing instructions up to 4000 characters, and refuses more', () => {
    expect(
      Expert.parse({ ...claudeCode, instructions: 'Find the cause first.' }).instructions,
    ).toBe('Find the cause first.');
    expect(Expert.safeParse({ ...claudeCode, instructions: 'x'.repeat(4000) }).success).toBe(true);
    expect(Expert.safeParse({ ...claudeCode, instructions: 'x'.repeat(4001) }).success).toBe(false);
  });

  it('may search the web when the connection says so', () => {
    const expert = Expert.parse({
      ...claudeCode,
      connection: { ...claudeCode.connection, canSearchWeb: true },
    });
    expect(expert.connection.canSearchWeb).toBe(true);
  });

  it('refuses an id that is not kebab-case', () => {
    expect(Expert.safeParse({ ...claudeCode, id: 'Claude Code' }).success).toBe(false);
  });

  it('needs no folder: the project is chosen per task', () => {
    expect(Expert.safeParse({ ...claudeCode, connection: { type: 'claude-code' } }).success).toBe(
      true,
    );
    expect(
      Expert.safeParse({ ...claudeCode, connection: { type: 'claude-code', folder: '' } }).success,
    ).toBe(false);
  });

  it('refuses a connector type it does not know', () => {
    expect(
      Expert.safeParse({ ...claudeCode, connection: { type: 'telepathy', folder: 'x' } }).success,
    ).toBe(false);
  });
});

describe('Brief', () => {
  it('needs an ask', () => {
    expect(Brief.safeParse({ ask: '' }).success).toBe(false);
    expect(Brief.parse({ ask: 'Why?', files: ['a.ts'] })).toEqual({ ask: 'Why?', files: ['a.ts'] });
  });
});

describe('hand-off wire', () => {
  it('finishes done with text and changed files, or with an error', () => {
    const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    expect(
      HandoffFinishedParams.safeParse({
        handoffId: id,
        expertId: 'claude-code',
        state: 'done',
        text: 'Fixed.',
        changedFiles: ['a.ts'],
      }).success,
    ).toBe(true);
    expect(
      HandoffFinishedParams.safeParse({
        handoffId: id,
        expertId: 'claude-code',
        state: 'error',
        error: 'not signed in',
      }).success,
    ).toBe(true);
  });
});

describe('proposals', () => {
  const proposalId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const project = { name: 'ai_pet', path: 'C:\\projects\\ai_pet', reason: 'screen' as const };

  it('proposes a brief with the best project guess and the others', () => {
    const proposed = HandoffProposedParams.parse({
      proposalId,
      petId: 'scout',
      expertId: 'claude-code',
      expertName: 'Claude Code',
      brief: { ask: 'Why does this test fail?' },
      projects: [project],
      canEdit: false,
    });
    expect(proposed.projects[0]?.reason).toBe('screen');
  });

  it('confirms with the folder the person settled on', () => {
    expect(
      HandoffsConfirmParams.parse({ proposalId, folder: 'D:\\code\\site', canEdit: false }),
    ).toEqual({ proposalId, folder: 'D:\\code\\site', canEdit: false });
    expect(HandoffsConfirmParams.safeParse({ proposalId, canEdit: false }).success).toBe(false);
  });

  it('answers a project search with candidates', () => {
    expect(ProjectsSearchResult.parse({ projects: [project] }).projects).toHaveLength(1);
  });
});
