/** Tests for the Runs on choices: the brain's placement_list read as rows, and a choice turned back into a placement. */
import { describe, expect, it } from 'vitest';
import { choiceOf, parsePlacements, placeOf } from './placements';

const THIS_PC = 'node-ab12';

describe('parsePlacements', () => {
  it('keys each placement by kind and id, with the node id of this PC', () => {
    const state = parsePlacements(
      {
        placements: [
          { kind: 'app', id: 'gmail', mode: 'brain', body_id: null, prefer: null },
          { kind: 'expert', id: 'claude_code', mode: 'both', body_id: THIS_PC, prefer: 'ask' },
        ],
      },
      THIS_PC,
    );
    expect(state.thisPc).toBe(THIS_PC);
    expect(state.places['app:gmail']).toEqual({ mode: 'brain', bodyId: null, prefer: null });
    expect(state.places['expert:claude_code']).toEqual({
      mode: 'both',
      bodyId: THIS_PC,
      prefer: 'ask',
    });
  });
});

describe('Runs on choices', () => {
  it('reads no placement as the brain, and Both with ask as Ask me each time', () => {
    expect(choiceOf(undefined)).toEqual({ choice: 'brain', tryFirst: 'body' });
    expect(choiceOf({ mode: 'both', bodyId: THIS_PC, prefer: 'ask' }).choice).toBe('ask');
    expect(choiceOf({ mode: 'both', bodyId: THIS_PC, prefer: 'brain' })).toEqual({
      choice: 'both',
      tryFirst: 'brain',
    });
  });

  it('maps each choice onto the existing placements', () => {
    expect(placeOf('brain', 'body', THIS_PC)).toEqual({
      mode: 'brain',
      bodyId: null,
      prefer: null,
    });
    expect(placeOf('body', 'body', THIS_PC)).toEqual({
      mode: 'body',
      bodyId: THIS_PC,
      prefer: null,
    });
    expect(placeOf('both', 'brain', THIS_PC)).toEqual({
      mode: 'both',
      bodyId: THIS_PC,
      prefer: 'brain',
    });
    expect(placeOf('ask', 'body', THIS_PC)).toEqual({
      mode: 'both',
      bodyId: THIS_PC,
      prefer: 'ask',
    });
  });
});
