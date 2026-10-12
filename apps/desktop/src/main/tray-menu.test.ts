import { describe, expect, it, vi } from 'vitest';
import { trayMenuTemplate } from './tray-menu';
import type { TrayActions } from './tray-menu';

function actions(): TrayActions {
  return {
    togglePets: vi.fn(),
    toggleSightPause: vi.fn(),
    openOffice: vi.fn(),
    quit: vi.fn(),
  };
}

function click(template: ReturnType<typeof trayMenuTemplate>, label: string): void {
  const item = template.find((entry) => entry.label === label);
  if (item?.click === undefined) throw new Error(`no clickable '${label}' item`);
  (item.click as () => void)();
}

describe('trayMenuTemplate', () => {
  it('keeps to four items: one window holds everything else', () => {
    const labels = trayMenuTemplate(actions(), { sightPaused: false }).map(
      (entry) => entry.label ?? entry.type,
    );
    expect(labels).toEqual([
      'Open Tagalong',
      'Pause sight',
      'Show or hide Scout',
      'separator',
      'Quit',
    ]);
  });

  it('ticks Pause sight while sight is paused', () => {
    const pause = trayMenuTemplate(actions(), { sightPaused: true }).find(
      (entry) => entry.label === 'Pause sight',
    );
    expect(pause).toMatchObject({ type: 'checkbox', checked: true });
  });

  it('wires every item to its action', () => {
    const handlers = actions();
    const template = trayMenuTemplate(handlers, { sightPaused: false });
    click(template, 'Open Tagalong');
    click(template, 'Pause sight');
    click(template, 'Show or hide Scout');
    click(template, 'Quit');
    expect(handlers.openOffice).toHaveBeenCalledOnce();
    expect(handlers.toggleSightPause).toHaveBeenCalledOnce();
    expect(handlers.togglePets).toHaveBeenCalledOnce();
    expect(handlers.quit).toHaveBeenCalledOnce();
  });
});
