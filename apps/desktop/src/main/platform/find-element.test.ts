import type { WindowEntry } from '@tagalong/protocol';
import { describe, expect, it, vi } from 'vitest';

import { findElementScript, findElementWith, parseFoundElement } from './find-element';

function entry(partial: Partial<WindowEntry> = {}): WindowEntry {
  return {
    id: 'w-42',
    processName: 'EXCEL.EXE',
    title: 'Budget.xlsx',
    state: 'background',
    browser: false,
    ...partial,
  };
}

function deps(
  windows: WindowEntry[],
  stdout = '{"status":"found","x":10,"y":20,"width":30,"height":40}',
) {
  const run = vi.fn().mockResolvedValue(stdout);
  return { run, listWindows: () => Promise.resolve(windows) };
}

describe('findElementScript', () => {
  it('starts from the window’s handle and never searches the desktop root', () => {
    const script = findElementScript(42, 'Export');
    expect(script).toContain('Get-TagalongWindow 42');
    expect(script).toContain('$w.FindFirst([System.Windows.Automation.TreeScope]::Descendants');
    expect(script).not.toMatch(
      /RootElement\.Find\w+\(\s*\[System\.Windows\.Automation\.TreeScope\]::Descendants/,
    );
  });

  it('tries an exact name first, then the same name ignoring case', () => {
    const script = findElementScript(42, 'Export');
    const exact = script.indexOf('PropertyCondition($nameProp, $name)');
    const loose = script.indexOf('PropertyConditionFlags]::IgnoreCase');
    expect(exact).toBeGreaterThan(-1);
    expect(loose).toBeGreaterThan(exact);
  });

  it('never puts the name into the script as code', () => {
    const name = "x'); Remove-Item C:\\ -Recurse; ('";
    const script = findElementScript(42, name);
    expect(script).not.toContain(name);
    expect(script).not.toContain('Remove-Item');
    expect(script).toContain(Buffer.from(name, 'utf8').toString('base64'));
  });

  it('refuses a handle that is not a safe integer', () => {
    expect(() => findElementScript(1.5, 'Export')).toThrow(TypeError);
    expect(() => findElementScript(Number.NaN, 'Export')).toThrow(TypeError);
  });
});

describe('parseFoundElement', () => {
  it('reads a found rectangle in screen pixels', () => {
    expect(parseFoundElement('{"status":"found","x":-1910,"y":20,"width":30,"height":40}')).toEqual(
      {
        status: 'found',
        rect: { x: -1910, y: 20, width: 30, height: 40 },
      },
    );
  });

  it('reads a miss, a closed window and nonsense', () => {
    expect(parseFoundElement('{"status":"missing"}')).toEqual({ status: 'missing' });
    expect(parseFoundElement('{"status":"gone"}')).toEqual({ status: 'gone' });
    expect(parseFoundElement('{"status":"offscreen"}')).toEqual({ status: 'offscreen' });
    expect(parseFoundElement('')).toEqual({ status: 'failed' });
    expect(parseFoundElement('not json')).toEqual({ status: 'failed' });
    expect(parseFoundElement('{"status":"found","x":1,"y":2,"width":0,"height":4}')).toEqual({
      status: 'failed',
    });
  });
});

describe('findElementWith', () => {
  it('finds the element in the named window', async () => {
    const d = deps([entry()]);
    const answer = await findElementWith(d, { windowId: 'w-42', name: 'Export' });
    expect(answer).toEqual({ found: true, rect: { x: 10, y: 20, width: 30, height: 40 } });
    expect(d.run).toHaveBeenCalledTimes(1);
    expect(d.run.mock.calls[0]?.[0]).toContain('Get-TagalongWindow 42');
  });

  it('refuses an excluded window before any walk', async () => {
    const blocked = { rule: 'processName' as const, entry: '1Password.exe' };
    const d = deps([entry({ processName: '1Password.exe', blocked })]);
    const answer = await findElementWith(d, { windowId: 'w-42', name: 'Vault' });
    expect(answer).toMatchObject({ found: false, blocked });
    expect(d.run).not.toHaveBeenCalled();
  });

  it('asks for a minimized window to be brought forward, without walking it', async () => {
    const d = deps([entry({ state: 'minimized' })]);
    const answer = await findElementWith(d, { windowId: 'w-42', name: 'Export' });
    expect(answer.found).toBe(false);
    expect(answer.found === false && answer.notes.join(' ')).toContain('EXCEL.EXE');
    expect(answer.found === false && answer.notes.join(' ')).toMatch(
      /bring it forward and ask again/,
    );
    expect(d.run).not.toHaveBeenCalled();
  });

  it('says when the window is not open, or the id is not one this host issued', async () => {
    const d = deps([entry({ id: 'w-1' })]);
    const missing = await findElementWith(d, { windowId: 'w-42', name: 'Export' });
    expect(missing.found === false && missing.notes.join(' ')).toContain('no window w-42');
    const invented = await findElementWith(deps([entry({ id: 'zz' })]), {
      windowId: 'zz',
      name: 'Export',
    });
    expect(invented.found).toBe(false);
  });

  it('says plainly when nothing has that name', async () => {
    const answer = await findElementWith(deps([entry()], '{"status":"missing"}'), {
      windowId: 'w-42',
      name: 'Export',
    });
    expect(answer.found === false && answer.notes.join(' ')).toContain("no element named 'Export'");
  });

  it('turns a helper that fails into a note rather than a throw', async () => {
    const d = {
      run: vi.fn().mockRejectedValue(new Error('timed out')),
      listWindows: () => Promise.resolve([entry()]),
    };
    const answer = await findElementWith(d, { windowId: 'w-42', name: 'Export' });
    expect(answer.found).toBe(false);
  });
});
