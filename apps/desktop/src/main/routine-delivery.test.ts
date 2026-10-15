import { describe, expect, it } from 'vitest';
import type { RoutineResultParams } from '@tagalong/protocol';
import { routineDelivery } from './routine-delivery';

const result = (deliver: Partial<RoutineResultParams['deliver']>): RoutineResultParams => ({
  routineId: '70000000-0000-4000-8000-000000000001',
  name: 'Morning papers',
  petId: 'scout',
  state: 'done',
  line: 'Morning papers: Two new papers.',
  text: 'Two new papers. The first matters most.',
  late: false,
  deliver: { bubble: false, voice: false, notification: false, ...deliver },
});

const shown = { avatarVisible: true, panelVisible: false };

describe('routineDelivery', () => {
  it('shows the line beside Scout when the bubble is chosen and closed', () => {
    expect(routineDelivery(result({ bubble: true }), shown)).toEqual({
      line: true,
      speak: false,
      notice: null,
    });
  });

  it('speaks when voice is chosen, and notifies when a notification is', () => {
    expect(routineDelivery(result({ voice: true, notification: true }), shown)).toEqual({
      line: false,
      speak: true,
      notice: { title: 'Morning papers', body: 'Two new papers. The first matters most.' },
    });
  });

  it('sends a meeting prep held by a call as a notification only, never aloud', () => {
    // The engine turns a prep that waited past its meeting's start into notification only.
    expect(routineDelivery(result({ notification: true }), shown)).toEqual({
      line: false,
      speak: false,
      notice: { title: 'Morning papers', body: 'Two new papers. The first matters most.' },
    });
  });

  it('never covers a bubble in use, or a hidden Scout: a notification says it instead', () => {
    expect(
      routineDelivery(result({ bubble: true }), { avatarVisible: true, panelVisible: true }),
    ).toMatchObject({ line: false, notice: { title: 'Morning papers' } });
    expect(
      routineDelivery(result({ bubble: true }), { avatarVisible: false, panelVisible: false }),
    ).toMatchObject({ line: false, notice: { title: 'Morning papers' } });
  });

  it('says a late run, a failed one, and cuts a long answer', () => {
    expect(
      routineDelivery({ ...result({ notification: true }), late: true }, shown).notice?.title,
    ).toBe('Morning papers (ran late)');
    expect(
      routineDelivery({ ...result({ notification: true }), state: 'error', text: 'No key.' }, shown)
        .notice,
    ).toEqual({ title: 'Morning papers did not run', body: 'No key.' });
    const long = routineDelivery(
      { ...result({ notification: true }), text: 'word '.repeat(80) },
      shown,
    );
    expect(long.notice?.body.length).toBeLessThan(200);
  });
});
