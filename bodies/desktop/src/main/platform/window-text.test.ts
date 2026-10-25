/** Tests for the window text scripts and their parser. */

import { describe, expect, it } from 'vitest';

import { countWindowTextScript, parseWindowText, readWindowTextScript } from './window-text';

/** One element as the helper prints it. */
function node(
  partial: Partial<{ name: string; type: string; value: string; top: number; left: number }>,
): Record<string, unknown> {
  return { name: '', type: 'Text', value: '', top: 0, left: 0, ...partial };
}

const MAX = 8_000;

describe('parseWindowText', () => {
  it('reads value text and element names into lines', () => {
    const { text } = parseWindowText(
      JSON.stringify([node({ name: 'Save' }), node({ type: 'Edit', value: 'const x = 1' })]),
      MAX,
    );

    expect(text).toContain('Save');
    expect(text).toContain('const x = 1');
  });

  it('prefers an element value over its name', () => {
    // UIA reports a textbox's label as Name and its contents as Value. The contents are
    // what the user is looking at.
    const { text } = parseWindowText(
      JSON.stringify([node({ name: 'Search', type: 'Edit', value: 'exclusions.ts' })]),
      MAX,
    );

    expect(text).toContain('exclusions.ts');
    expect(text).not.toContain('Search');
  });

  it('orders by position on screen, not by the order the tree walk found them', () => {
    // A UIA tree walk returns z-order and nesting, which has nothing to do with reading
    // order. A terminal's last line arriving before its first is worse than useless.
    const { text } = parseWindowText(
      JSON.stringify([
        node({ name: 'third', top: 300, left: 0 }),
        node({ name: 'first', top: 100, left: 0 }),
        node({ name: 'second', top: 200, left: 0 }),
      ]),
      MAX,
    );

    expect(text.split('\n')).toEqual(['first', 'second', 'third']);
  });

  it('reads left to right within a row', () => {
    const { text } = parseWindowText(
      JSON.stringify([
        node({ name: 'right', top: 100, left: 900 }),
        node({ name: 'left', top: 100, left: 20 }),
      ]),
      MAX,
    );

    expect(text.split('\n')).toEqual(['left', 'right']);
  });

  it('drops empty elements rather than emitting blank lines', () => {
    const { text } = parseWindowText(
      JSON.stringify([node({ name: 'a' }), node({}), node({ name: '   ' }), node({ name: 'b' })]),
      MAX,
    );

    expect(text.split('\n')).toEqual(['a', 'b']);
  });

  it('collapses a line repeated by a parent and its child', () => {
    // A Document element commonly republishes the text of the element inside it. Sending
    // both doubles the bill for the same words.
    const { text } = parseWindowText(
      JSON.stringify([
        node({ name: 'error TS2532', top: 10 }),
        node({ name: 'error TS2532', top: 10 }),
      ]),
      MAX,
    );

    expect(text).toBe('error TS2532');
  });

  it('keeps a repeat that is genuinely somewhere else on screen', () => {
    // Two terminal lines that happen to read the same are two lines, not one.
    const { text } = parseWindowText(
      JSON.stringify([
        node({ name: 'PASS', top: 10 }),
        node({ name: 'npm test', top: 20 }),
        node({ name: 'PASS', top: 30 }),
      ]),
      MAX,
    );

    expect(text.split('\n')).toEqual(['PASS', 'npm test', 'PASS']);
  });

  it('flattens newlines inside one element so line counts stay honest', () => {
    const { text } = parseWindowText(
      JSON.stringify([node({ type: 'Document', value: 'line one\r\nline two' })]),
      MAX,
    );

    expect(text.split('\n')).toEqual(['line one', 'line two']);
  });

  it('stops at the cap and says it truncated', () => {
    // Distinct lines: identical consecutive ones collapse by design, which would leave
    // one short line and nothing to truncate.
    const long = Array.from({ length: 50 }, (_, index) =>
      node({ name: `${index}`.padEnd(40, 'x'), top: index }),
    );
    const { text, truncated } = parseWindowText(JSON.stringify(long), 100);

    expect(text.length).toBeLessThanOrEqual(100);
    expect(truncated).toBe(true);
  });

  it('does not claim truncation when everything fitted', () => {
    const { text, truncated } = parseWindowText(JSON.stringify([node({ name: 'short' })]), MAX);

    expect(text).toBe('short');
    expect(truncated).toBe(false);
  });

  it('cuts at a line boundary rather than mid-word where it can', () => {
    const { text } = parseWindowText(
      JSON.stringify([node({ name: 'aaaa', top: 1 }), node({ name: 'bbbb', top: 2 })]),
      7,
    );

    // 'aaaa\nbbbb' is 9 characters against a cap of 7. Keeping the whole first line beats
    // handing the pet 'aaaa\nbb'.
    expect(text).toBe('aaaa');
  });

  it('returns nothing readable for output that is not JSON', () => {
    // The helper shares stdout with whatever PowerShell decides to print, and returns
    // partial output when it times out. A read that yields nothing is a pet that knows
    // less; a thrown error is an ask that fails.
    for (const junk of ['', '   ', 'At line:1 char:1', '{"unterminated": ']) {
      const { text, truncated } = parseWindowText(junk, MAX);
      expect(text).toBe('');
      expect(truncated).toBe(false);
    }
  });

  it('accepts the bare object PowerShell emits for a single element', () => {
    // ConvertTo-Json unwraps a one-element array unless told otherwise.
    const { text } = parseWindowText(JSON.stringify(node({ name: 'only' })), MAX);

    expect(text).toBe('only');
  });

  it('ignores entries that are not shaped like elements', () => {
    const { text } = parseWindowText(JSON.stringify([null, 42, node({ name: 'real' })]), MAX);

    expect(text).toBe('real');
  });

  it('returns an empty read for a window that published nothing', () => {
    const { text, truncated } = parseWindowText(JSON.stringify([]), MAX);

    expect(text).toBe('');
    expect(truncated).toBe(false);
  });
});

describe('readWindowTextScript', () => {
  it('targets the handle it was given', () => {
    expect(readWindowTextScript(123456)).toContain('123456');
  });

  it('interpolates the handle as a bare integer and nothing else', () => {
    // The script is fed to PowerShell. Every value that reaches it is a number here, and
    // this is the test that keeps it that way: the moment a string is interpolated into
    // a shell script, a window title becomes a code path.
    for (const bad of [1.5, NaN, Infinity, -0.1, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => readWindowTextScript(bad)).toThrow();
    }
  });

  it('rejects anything that is not a number at all', () => {
    const notNumbers = ['1; Remove-Item -Recurse /', '$(whoami)', null, undefined, {}];
    for (const bad of notNumbers) {
      expect(() => readWindowTextScript(bad as unknown as number)).toThrow();
    }
  });

  it('reads no other window than the one named', () => {
    const script = readWindowTextScript(42);
    // The walk starts from an element found by handle, never from the desktop root, so a
    // read cannot quietly become an enumeration of everything.
    expect(script).not.toContain('RootElement.FindAll');
  });
});

describe('countWindowTextScript', () => {
  it('counts every handle it was given', () => {
    const script = countWindowTextScript([11, 22, 33]);
    for (const handle of ['11', '22', '33']) expect(script).toContain(handle);
  });

  it('drops a handle that is not a safe integer instead of failing the whole pass', () => {
    // One bad entry from enumeration must not cost the counts for every other window.
    const script = countWindowTextScript([11, 1.5, 22]);
    expect(script).toContain('11');
    expect(script).toContain('22');
    expect(script).not.toContain('1.5');
  });

  it('returns a script that counts nothing when there is nothing to count', () => {
    // PowerShell's empty array literal, so the loop body never runs and the script still
    // prints well-formed JSON for the parser.
    expect(countWindowTextScript([])).toContain('$handles = @()');
  });
});

describe('telling a failed read from a window with nothing in it', () => {
  it('reports no-output when the helper printed nothing at all', () => {
    // A helper that returned zero bytes and a window that published zero characters are
    // not the same thing, and collapsing them makes the pet say "this window is empty"
    // when the truth is "the read never ran".
    expect(parseWindowText('', 8_000).failure).toBe('no-output');
    expect(parseWindowText('  ', 8_000).failure).toBe('no-output');
  });

  it('reports unparseable for output that is not JSON', () => {
    expect(parseWindowText('At line:1 char:1', 8_000).failure).toBe('unparseable');
  });

  it('reports no failure for a window that legitimately published nothing', () => {
    // An empty array is a real answer: the helper ran, walked the tree and found no text.
    const reading = parseWindowText('[]', 8_000);

    expect(reading.failure).toBeUndefined();
    expect(reading.text).toBe('');
  });

  it('reports no failure for a window that published text', () => {
    expect(parseWindowText(JSON.stringify([node({ name: 'a' })]), 8_000).failure).toBeUndefined();
  });
});
