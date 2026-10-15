import { describe, expect, it } from 'vitest';
import type { Expert } from '@tagalong/protocol';
import type { SightRow } from '../memory/sight-log';
import { FakeConnector } from './fake';
import { recordExpertSends } from './record-expert';
import { renderBrief } from './connector';

const EXPERT = {
  id: 'coder',
  name: 'Coder',
  enabled: true,
  connection: { type: 'claude-code', canEdit: false },
} as unknown as Expert;

describe('recordExpertSends', () => {
  it('writes one row per brief sent, with the expert and the brief size, never the brief', async () => {
    const rows: SightRow[] = [];
    const modes: unknown[] = [];
    const connectorFor = recordExpertSends(
      (_expert, mode) => {
        modes.push(mode);
        return new FakeConnector({ steps: [], text: 'done' });
      },
      { record: (row) => void rows.push(row) },
    );
    const brief = { ask: 'Fix the secret-sauce test' };
    const connector = connectorFor(EXPERT, { research: true });
    const result = await connector.send(brief, () => {});

    expect(result).toMatchObject({ ok: true });
    expect(modes).toEqual([{ research: true }]);
    expect(rows).toEqual([
      { kind: 'sent_to_expert', expertName: 'Coder', chars: renderBrief(brief).length },
    ]);
    expect(JSON.stringify(rows)).not.toContain('secret-sauce');
  });

  it('writes nothing for a check, which sends no brief', async () => {
    const rows: SightRow[] = [];
    const connectorFor = recordExpertSends(() => new FakeConnector({ steps: [], text: '' }), {
      record: (row) => void rows.push(row),
    });
    await connectorFor(EXPERT).check();
    expect(rows).toEqual([]);
  });
});
