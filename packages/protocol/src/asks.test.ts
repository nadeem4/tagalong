/** Tests for the ask schemas and the asks.* methods. */
import { describe, expect, it } from 'vitest';
import {
  Ask,
  AsksAnswerParams,
  AsksAnswerResult,
  AsksChangedParams,
  AsksListParams,
  AsksListResult,
  AsksOpenParams,
  AsksOpenResult,
} from './asks';
import { ConnectorConfirmParams } from './connections';
import { HandoffProposedParams } from './experts';
import { coreToHostNotifications, hostToCoreMethods } from './methods';

const ID = '00000000-0000-4000-8000-000000000001';
const TURN = '00000000-0000-4000-8000-000000000002';
const AT = '2026-10-22T10:00:00.000Z';

const WAITING = {
  id: ID,
  kind: 'app-change',
  petId: 'scout',
  summary: 'Create a page\ntitle: Plan',
  risk: 'change',
  app: 'Notion',
  tool: 'create_page',
  originTurnId: TURN,
  state: 'waiting',
  createdAt: AT,
  expiresAt: AT,
} as const;

describe('Ask', () => {
  it('takes a waiting app change and an answered hand-off', () => {
    expect(Ask.parse(WAITING)).toEqual(WAITING);
    const answered = {
      id: ID,
      kind: 'handoff',
      petId: 'scout',
      summary: 'Fix the failing test',
      risk: 'change',
      expertName: 'Claude Code',
      state: 'expired',
      note: 'expired',
      createdAt: AT,
      answeredAt: AT,
    };
    expect(Ask.parse(answered)).toEqual(answered);
    const { note: _note, ...approved } = { ...answered, state: 'approved', answeredBy: 'you' };
    expect(Ask.parse(approved)).toEqual(approved);
  });

  it('refuses a state, risk, kind, answerer or note it does not know', () => {
    expect(() => Ask.parse({ ...WAITING, state: 'sent' })).toThrow();
    expect(() => Ask.parse({ ...WAITING, risk: 'scary' })).toThrow();
    expect(() => Ask.parse({ ...WAITING, kind: 'routine' })).toThrow();
    expect(() => Ask.parse({ ...WAITING, answeredBy: 'scout' })).toThrow();
    expect(() => Ask.parse({ ...WAITING, note: 'because' })).toThrow();
    expect(() => Ask.parse({ ...WAITING, id: 'a1' })).toThrow();
  });
});

describe('asks.* methods', () => {
  it('lists the waiting and the recently answered', () => {
    expect(AsksListParams.parse({})).toEqual({});
    const listed = { waiting: [WAITING], recent: [] };
    expect(AsksListResult.parse(listed)).toEqual(listed);
    expect(hostToCoreMethods['asks.list'].result).toBe(AsksListResult);
  });

  it('answers with approve or decline only', () => {
    expect(AsksAnswerParams.parse({ id: ID, decision: 'approve' })).toEqual({
      id: ID,
      decision: 'approve',
    });
    expect(() => AsksAnswerParams.parse({ id: ID, decision: 'once' })).toThrow();
    expect(AsksAnswerResult.parse({ accepted: false })).toEqual({ accepted: false });
    expect(hostToCoreMethods['asks.answer'].params).toBe(AsksAnswerParams);
  });

  it('opens an ask by id', () => {
    expect(AsksOpenParams.parse({ id: ID })).toEqual({ id: ID });
    expect(AsksOpenResult.parse({ opened: true })).toEqual({ opened: true });
    expect(hostToCoreMethods['asks.open'].params).toBe(AsksOpenParams);
  });

  it('notifies the waiting list on every change', () => {
    expect(AsksChangedParams.parse({ waiting: [WAITING] })).toEqual({ waiting: [WAITING] });
    expect(coreToHostNotifications['asks.changed'].params).toBe(AsksChangedParams);
  });
});

describe('the cards', () => {
  it('a confirm card may carry its risk', () => {
    const confirm = {
      approvalId: ID,
      turnId: TURN,
      petId: 'scout',
      app: 'Notion',
      tool: 'delete_page',
      summary: 'Delete a page',
    };
    expect(ConnectorConfirmParams.parse(confirm)).toEqual(confirm);
    expect(ConnectorConfirmParams.parse({ ...confirm, risk: 'high' })).toMatchObject({
      risk: 'high',
    });
    expect(() => ConnectorConfirmParams.parse({ ...confirm, risk: 'scary' })).toThrow();
  });

  it('a hand-off card may say it was restored', () => {
    const proposed = {
      proposalId: ID,
      petId: 'scout',
      expertId: 'claude-code',
      expertName: 'Claude Code',
      brief: { ask: 'Fix it' },
      projects: [],
      canEdit: false,
    };
    expect(HandoffProposedParams.parse({ ...proposed, restored: true })).toMatchObject({
      restored: true,
    });
    expect(() => HandoffProposedParams.parse({ ...proposed, restored: false })).toThrow();
  });
});
