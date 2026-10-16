/**
 * Runs the real recogniser through the app's own PowerShell runner, on a picture drawn here,
 * so it needs nothing on screen. Every other test feeds fixture output; only this one shows
 * the script actually runs, the way the transport test does for the window list.
 */

import { describe, expect, it } from 'vitest';
import { NO_RECOGNISER, OCR_SCRIPT, recognizeText } from './ocr';
import { runPowerShellScript } from './powershell';

const onWindows = process.platform === 'win32';

const DRAW_TEXT = String.raw`
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 700,120
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font('Consolas', 22)
$g.DrawString('npm test failed', $font, [System.Drawing.Brushes]::Black, 10, 10)
$g.DrawString('expected 3 to be 4', $font, [System.Drawing.Brushes]::Black, 10, 60)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Convert]::ToBase64String($ms.ToArray())
`;

describe.skipIf(!onWindows)('text recognition through the real PowerShell', () => {
  it('reads the text in a picture handed over on stdin', async (context) => {
    const png = (await runPowerShellScript(DRAW_TEXT, 30_000)).trim();
    expect(png.length).toBeGreaterThan(100);

    // A Windows without a recogniser for its languages has nothing to test here.
    const raw = await runPowerShellScript(OCR_SCRIPT, 30_000, png);
    if (raw.trim() === NO_RECOGNISER) context.skip();

    const text = await recognizeText(runPowerShellScript, png);
    expect(text).toMatch(/npm test failed/i);
    expect(text).toMatch(/expected 3 to be 4/i);
  }, 60_000);
});
