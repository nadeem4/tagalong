import { describe, expect, it } from 'vitest';
import { Brief, Expert, HandoffFinishedParams, HandoffsStartParams } from './experts';

const claudeCode = {
  id: 'claude-code',
  name: 'Claude Code',
  goodAt: 'Code changes in this repo',
  connection: { type: 'claude-code', folder: 'C:\\projects\\ai_pet' },
};

describe('Expert', () => {
  it('fills the defaults: on, read-only', () => {
    expect(Expert.parse(claudeCode)).toEqual({
      ...claudeCode,
      enabled: true,
      connection: { ...claudeCode.connection, canEdit: false },
    });
  });

  it('refuses an id that is not kebab-case', () => {
    expect(Expert.safeParse({ ...claudeCode, id: 'Claude Code' }).success).toBe(false);
  });

  it('refuses a Claude Code expert without a folder', () => {
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
  it('starts with an expert, the companion, and a brief', () => {
    expect(
      HandoffsStartParams.parse({ expertId: 'claude-code', petId: 'scout', brief: { ask: 'x' } }),
    ).toEqual({ expertId: 'claude-code', petId: 'scout', brief: { ask: 'x' } });
  });

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
