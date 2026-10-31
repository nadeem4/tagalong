/**
 * Source guards: facts about the code that a unit test of behaviour cannot see. Only an
 * extension page may call chrome.permissions.request (the worker is not a click), and the body
 * depends on the contract alone.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

describe('source guards', () => {
  it('only_the_permission_page_and_popup_call_permissions_request', () => {
    for (const rel of ['service-worker.ts', 'body.ts', 'permissions.ts']) {
      expect(read(rel), rel).not.toContain('permissions.request');
    }
    for (const path of sources(join(SRC, 'tools'))) {
      expect(readFileSync(path, 'utf8'), path).not.toContain('permissions.request');
    }
    for (const path of sources(join(SRC, 'layer'))) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/permissions\.request\(/);
    }
    expect(read('permission/permission.ts')).toContain('permissions.request');
  });

  it('bodies_browser_imports_no_ui_package', () => {
    for (const path of sources(SRC)) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(
        /from '(@tagalong\/ui|react|react-dom)(\/[^']*)?'/,
      );
    }
  });

  it('the_microphone_code_keeps_audio_in_memory_and_off_the_network', () => {
    // Frames go to the worker as messages and out only over the brain websocket: no recorder, no
    // file or storage write, no request of any kind.
    const mic = [...sources(join(SRC, 'voice')), ...sources(join(SRC, 'offscreen'))];
    for (const path of mic) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(
        /MediaRecorder|fetch\(|XMLHttpRequest|sendBeacon|localStorage|indexedDB|\.storage\./,
      );
    }
  });
});
