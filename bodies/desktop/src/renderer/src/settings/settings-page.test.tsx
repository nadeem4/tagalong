/**
 * Tests for the Settings form's layout: one Save at the top, no footer, and the voice and
 * shortcut controls on the shared controls. Static render (no DOM in this suite); the
 * network-backed parts are effects and do not run here.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '@tagalong/ui';
import type { HostBridge } from '@tagalong/ui';
import { SETTINGS_DEFAULTS } from '../../../shared/settings';
import type { HostView } from '../../../shared/ipc';
import { SettingsFormView } from './settings-page';

const VIEW = { settings: SETTINGS_DEFAULTS, platform: 'win32' } as unknown as HostView;

function render(status = '', statusIsError = false, view: HostView = VIEW): string {
  return renderToStaticMarkup(
    <HostBridgeProvider bridge={{} as HostBridge}>
      <SettingsFormView
        view={view}
        browserFolder={null}
        ui={{ tip: null, toggleTip: () => undefined, invalid: null }}
        status={status}
        statusIsError={statusIsError}
        onSubmit={() => undefined}
        onAddFolder={() => undefined}
        onRemoveFolder={() => undefined}
      />
    </HostBridgeProvider>,
  );
}

describe('SettingsFormView', () => {
  it('has exactly one Save button', () => {
    expect(render().match(/type="submit"/g)).toHaveLength(1);
  });

  it('puts Save above the first section', () => {
    const html = render();
    expect(html.indexOf('>Save<')).toBeGreaterThan(-1);
    expect(html.indexOf('>Save<')).toBeLessThan(html.indexOf('<section'));
  });

  it('has no footer note', () => {
    expect(render()).not.toContain('Changes apply from the next ask');
  });

  it('shows a refused save as an alert and a saved one as a status', () => {
    expect(render('Speed is wrong', true)).toContain('role="alert"');
    expect(render('Saved. Scout uses it from the next ask.')).toContain('role="status"');
  });

  it('puts the save status on the heading row, left of Save', () => {
    const html = render('Saved. Scout uses it from the next ask.');
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf('>Save<'));
    expect(html.indexOf('>Save<')).toBeLessThan(html.indexOf('<section'));
  });

  it('draws every section as a home card', () => {
    const html = render();
    expect(html.match(/<section [^>]*class="[^"]*tg-card/g)).toHaveLength(8);
  });

  it('shows the ask shortcut as keycaps, never CommandOrControl as text', () => {
    const html = render();
    expect(html).toContain('<kbd class="tg-keycap">Ctrl</kbd>');
    expect(html).toContain('<kbd class="tg-keycap">Shift</kbd>');
    expect(html).not.toMatch(/>[^<]*CommandOrControl[^<]*</);
  });

  it('keeps the accelerator in a hidden field at rest, with a Change button per shortcut', () => {
    const html = render();
    expect(html).toMatch(
      /<input[^>]*type="hidden"[^>]*name="askHotkey"[^>]*value="CommandOrControl\+Shift\+Space"/,
    );
    expect(html).not.toMatch(/<input[^>]*id="f-askHotkey"/);
    expect(html.match(/>Change</g)).toHaveLength(3);
  });

  it('opens the field at once for a shortcut the last save refused', () => {
    const refused = {
      ...VIEW,
      hotkeyError: 'Could not take (CommandOrControl+Shift+Space)',
    } as unknown as HostView;
    const html = render('', false, refused);
    expect(html).toMatch(/<input[^>]*id="f-askHotkey"[^>]*aria-invalid="true"/);
  });

  it('renders an odd accelerator as plain keycaps without throwing', () => {
    const odd = {
      ...VIEW,
      settings: {
        ...SETTINGS_DEFAULTS,
        hotkeys: { ...SETTINGS_DEFAULTS.hotkeys, ask: 'Foo+Bar' },
      },
    } as unknown as HostView;
    const html = render('', false, odd);
    expect(html).toContain('<kbd class="tg-keycap">Foo</kbd>');
    expect(html).toContain('<kbd class="tg-keycap">Bar</kbd>');
  });

  it('Scout talks is a switch that saves through a hidden field', () => {
    const withTalks = (enabled: boolean): string =>
      render('', false, {
        ...VIEW,
        settings: { ...SETTINGS_DEFAULTS, voice: { ...SETTINGS_DEFAULTS.voice, enabled } },
      } as unknown as HostView);
    const on = withTalks(true);
    expect(on).toMatch(/role="switch"[^>]*aria-label="Scout talks"/);
    expect(on).toContain('name="voiceEnabled"');
    expect(withTalks(false)).not.toContain('name="voiceEnabled"');
  });

  it('keeps the microphone list starting at the system default', () => {
    expect(render()).toContain('>System default<');
  });
});
