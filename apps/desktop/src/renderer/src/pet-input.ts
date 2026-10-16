/**
 * Pointer and drag handling for the pet's button in the avatar window (petInput).
 * What the pet's button does with a pointer and with an HTML drag, kept apart from React so
 * it is tested in plain Node.
 *
 * The two never meet. A press that moves past the threshold moves the pet (dragAvatar, then
 * dropAvatar at the end); a file, link or text dragged in from another app is an HTML drag,
 * which only ever sends dropOnPet. Both drag events call preventDefault: without it Electron
 * opens the dropped file in this window. No mouse or keyboard is driven; these are the
 * person's own events.
 */
import type { PetDrop } from '../../shared/ipc';
import { moveDrag, startDrag } from './dock';
import type { DockEvent, DragState, Point } from './dock';

/** The host calls the figure makes: moving the pet, and handing over what was dropped. */
export interface PetInputHost {
  dragAvatar(dx: number, dy: number): Promise<void>;
  dropAvatar(): Promise<void>;
  dropOnPet(drop: PetDrop): Promise<void>;
}

/** The part of an HTML drag event the figure reads. */
export interface DragLike {
  preventDefault(): void;
  dataTransfer: {
    files: ArrayLike<File>;
    dropEffect: string;
    getData(type: string): string;
  } | null;
}

export function petInput(host: PetInputHost, send: (event: DockEvent) => void) {
  let drag: DragState | null = null;
  let dragged = false;

  return {
    pointerDown(at: Point): void {
      drag = startDrag(at);
      dragged = false;
    },
    pointerMove(at: Point): void {
      if (drag === null) return;
      const { state, step } = moveDrag(drag, at);
      drag = state;
      if (step === null) return;
      dragged = true;
      void host.dragAvatar(step.dx, step.dy);
    },
    pointerUp(): void {
      if (drag?.dragging === true) void host.dropAvatar();
      drag = null;
    },
    /** Whether a click is a click on the pet; the click that ends a drag is not. */
    takeClick(): boolean {
      if (!dragged) return true;
      dragged = false;
      return false;
    },
    dragOver(event: DragLike): void {
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
      send({ type: 'dropHover' });
    },
    dragLeave(): void {
      send({ type: 'dropLeave' });
    },
    drop(event: DragLike): void {
      event.preventDefault();
      send({ type: 'dropLeave' });
      const data = event.dataTransfer;
      if (data === null) return;
      const files = Array.from(data.files);
      const uri = data.getData('text/uri-list');
      const text = data.getData('text/plain');
      if (files.length === 0 && uri === '' && text === '') return;
      void host.dropOnPet({
        files,
        ...(uri !== '' ? { uri } : {}),
        ...(text !== '' ? { text } : {}),
      });
    },
  };
}
