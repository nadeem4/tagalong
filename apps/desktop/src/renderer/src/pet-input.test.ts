import { describe, expect, it } from 'vitest';
import type { DockEvent } from './dock';
import { petInput } from './pet-input';
import type { DragLike, PetInputHost } from './pet-input';

function fakeHost() {
  const calls: string[] = [];
  const dropped: unknown[] = [];
  const host: PetInputHost = {
    dragAvatar: (dx, dy) => {
      calls.push(`drag:${dx},${dy}`);
      return Promise.resolve();
    },
    dropAvatar: () => {
      calls.push('dropAvatar');
      return Promise.resolve();
    },
    dropOnPet: (drop) => {
      calls.push('dropOnPet');
      dropped.push(drop);
      return Promise.resolve();
    },
  };
  return { host, calls, dropped };
}

/** An HTML drag event as the figure sees it, with whatever the drag carries. */
function dragEvent(data: { files?: File[]; uri?: string; text?: string } = {}) {
  let prevented = false;
  const event: DragLike = {
    preventDefault: () => {
      prevented = true;
    },
    dataTransfer: {
      files: data.files ?? [],
      dropEffect: 'none',
      getData: (type) =>
        type === 'text/uri-list'
          ? (data.uri ?? '')
          : type === 'text/plain'
            ? (data.text ?? '')
            : '',
    },
  };
  return { event, prevented: () => prevented };
}

describe('petInput', () => {
  it('sends a file drop as dropOnPet, never as a move of the pet', () => {
    const { host, calls, dropped } = fakeHost();
    const events: DockEvent[] = [];
    const input = petInput(host, (event) => events.push(event));
    const file = new File(['x'], 'report.md');

    const over = dragEvent();
    input.dragOver(over.event);
    expect(over.prevented()).toBe(true);
    expect(over.event.dataTransfer?.dropEffect).toBe('copy');

    const drop = dragEvent({ files: [file], text: 'ignored here' });
    input.drop(drop.event);
    expect(drop.prevented()).toBe(true);
    expect(calls).toEqual(['dropOnPet']);
    expect(dropped).toEqual([{ files: [file], text: 'ignored here' }]);
    expect(events.map((event) => event.type)).toEqual(['dropHover', 'dropLeave']);
  });

  it('sends a link and text, and nothing for an empty drop', () => {
    const { host, dropped } = fakeHost();
    const input = petInput(host, () => undefined);
    input.drop(dragEvent({ uri: 'https://x.test/', text: 'https://x.test/' }).event);
    input.drop(dragEvent().event);
    expect(dropped).toEqual([{ files: [], uri: 'https://x.test/', text: 'https://x.test/' }]);
  });

  it('ends the hover when the drag leaves', () => {
    const events: DockEvent[] = [];
    const input = petInput(fakeHost().host, (event) => events.push(event));
    input.dragOver(dragEvent().event);
    input.dragLeave();
    expect(events.map((event) => event.type)).toEqual(['dropHover', 'dropLeave']);
  });

  it('moves the pet on a drag past the threshold and never sends dropOnPet', () => {
    const { host, calls } = fakeHost();
    const input = petInput(host, () => undefined);
    input.pointerDown({ x: 0, y: 0 });
    input.pointerMove({ x: 10, y: 0 });
    input.pointerUp();
    expect(calls).toEqual(['drag:10,0', 'dropAvatar']);
    // The click that ends a drag is not a click on the pet.
    expect(input.takeClick()).toBe(false);
    expect(input.takeClick()).toBe(true);
  });

  it('keeps a press that does not move a click', () => {
    const { host, calls } = fakeHost();
    const input = petInput(host, () => undefined);
    input.pointerDown({ x: 0, y: 0 });
    input.pointerMove({ x: 1, y: 1 });
    input.pointerUp();
    expect(calls).toEqual([]);
    expect(input.takeClick()).toBe(true);
  });
});
