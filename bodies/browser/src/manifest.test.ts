/**
 * Tests for the manifest's permissions, popup, description and socket policy. They pin what the
 * browser store and the person see at install: only four quiet permissions up front, the rest optional.
 */
import { describe, expect, it } from 'vitest';
import { manifest } from './manifest';
import { OPTIONAL_PERMISSIONS } from './permissions';

describe('manifest', () => {
  it('is_manifest_v3_with_a_module_service_worker', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({ service_worker: 'service-worker.js', type: 'module' });
  });

  it('requires_only_alarms_offscreen_scripting_and_storage', () => {
    // offscreen shows no warning; the microphone itself is asked from a page, never listed here.
    expect([...manifest.permissions].sort()).toEqual([
      'alarms',
      'offscreen',
      'scripting',
      'storage',
    ]);
  });

  it('lists_exactly_the_optional_permissions_the_broker_can_ask_for', () => {
    expect([...manifest.optional_permissions].sort()).toEqual([...OPTIONAL_PERMISSIONS].sort());
  });

  it('optional_host_permissions_is_all_urls_and_there_is_no_host_permissions', () => {
    expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
    expect('host_permissions' in manifest).toBe(false);
  });

  it('declares_the_scout_omnibox_keyword', () => {
    expect(manifest.omnibox).toEqual({ keyword: 'scout' });
  });

  it('has_a_popup_and_no_side_panel_options_or_commands', () => {
    expect(manifest.action.default_popup).toBe('popup/popup.html');
    expect('side_panel' in manifest).toBe(false);
    expect('options_ui' in manifest).toBe(false);
    expect('commands' in manifest).toBe(false);
  });

  it('lets_extension_pages_open_websockets_to_any_host', () => {
    expect(manifest.content_security_policy.extension_pages).toBe(
      "script-src 'self'; object-src 'self'; connect-src ws:",
    );
  });

  it('describes_scout_within_the_store_summary_limit', () => {
    expect(manifest.description).toContain('Scout');
    expect(manifest.description.length).toBeLessThanOrEqual(132);
    // It must say what the extension can now do: manage tabs, and ask Scout from a page.
    expect(manifest.description).toContain('manages tabs');
    expect(manifest.description).toContain('ask it from a page');
  });
});
