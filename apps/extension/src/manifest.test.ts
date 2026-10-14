import { describe, expect, it } from 'vitest';
import { COMMAND_OPEN_PANEL, manifest } from './manifest';

describe('manifest', () => {
  it('is Manifest V3 with a module service worker', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({ service_worker: 'service-worker.js', type: 'module' });
  });

  it('asks for the permissions the phase names plus alarms, with clipboard optional', () => {
    expect([...manifest.permissions].sort()).toEqual(
      ['activeTab', 'alarms', 'scripting', 'sidePanel', 'storage'].sort(),
    );
    expect(manifest.optional_permissions).toEqual(['clipboardRead']);
  });

  it('carries no standing host permission: pages are reached through activeTab only', () => {
    expect('host_permissions' in manifest).toBe(false);
  });

  it('offers reading any tab only as an optional grant the user switches on', () => {
    expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
  });

  it('points the side panel and options page at the built html', () => {
    expect(manifest.side_panel.default_path).toBe('sidepanel.html');
    expect(manifest.options_ui).toEqual({ page: 'options.html', open_in_tab: true });
  });

  it('declares the shortcut that opens the side panel', () => {
    const command = manifest.commands[COMMAND_OPEN_PANEL];
    expect(command?.suggested_key.default).toMatch(/Space$/);
    expect(command?.description.length).toBeGreaterThan(0);
  });

  it('describes Scout, not a crew, within the store summary limit', () => {
    expect(manifest.description).toContain('Scout');
    expect(manifest.description).not.toMatch(/crew/i);
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });

  it('lets extension pages open sockets to loopback and nowhere else', () => {
    expect(manifest.content_security_policy.extension_pages).toContain('ws://127.0.0.1:*');
  });
});
