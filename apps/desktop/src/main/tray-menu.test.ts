import { describe, expect, it, vi } from 'vitest';
import { trayMenuTemplate } from './tray-menu';
import type { TrayActions } from './tray-menu';

function actions(): TrayActions {
  return {
    togglePets: vi.fn(),
    toggleSightPause: vi.fn(),
    openOffice: vi.fn(),
    openSettings: vi.fn(),
    openOnboarding: vi.fn(),
    quit: vi.fn(),
  };
}

function click(template: ReturnType<typeof trayMenuTemplate>, label: string): void {
  const item = template.find((entry) => entry.label === label);
  if (item?.click === undefined) throw new Error(`no clickable '${label}' item`);
  (item.click as () => void)();
}

describe('trayMenuTemplate', () => {
  it('lists the items in order, with Open Home after the pets', () => {
    const labels = trayMenuTemplate(actions(), { sightPaused: false }).map(
      (entry) => entry.label ?? entry.type,
    );
    expect(labels).toEqual([
      'Show or hide pets',
      'Open Home',
      'Pause sight',
      'Settings',
      'Welcome',
      'separator',
      'Quit',
    ]);
  });

  it('opens Home from Open Home', () => {
    const handlers = actions();
    click(trayMenuTemplate(handlers, { sightPaused: false }), 'Open Home');
    expect(handlers.openOffice).toHaveBeenCalledOnce();
  });

  it('ticks Pause sight while sight is paused', () => {
    const pause = trayMenuTemplate(actions(), { sightPaused: true }).find(
      (entry) => entry.label === 'Pause sight',
    );
    expect(pause).toMatchObject({ type: 'checkbox', checked: true });
  });

  it('wires every other item to its action', () => {
    const handlers = actions();
    const template = trayMenuTemplate(handlers, { sightPaused: false });
    click(template, 'Show or hide pets');
    click(template, 'Pause sight');
    click(template, 'Settings');
    click(template, 'Welcome');
    click(template, 'Quit');
    expect(handlers.togglePets).toHaveBeenCalledOnce();
    expect(handlers.toggleSightPause).toHaveBeenCalledOnce();
    expect(handlers.openSettings).toHaveBeenCalledOnce();
    expect(handlers.openOnboarding).toHaveBeenCalledOnce();
    expect(handlers.quit).toHaveBeenCalledOnce();
  });
});
