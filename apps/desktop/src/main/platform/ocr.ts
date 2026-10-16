/**
 * Reading the text in a picture, with the recogniser built into Windows (Windows.Media.Ocr).
 *
 * For the apps that draw their own text and publish little to the text layer: terminals,
 * editors, viewers. Nothing is installed and nothing leaves the machine; the picture goes to
 * PowerShell on stdin as base64, so it is never written to disk.
 * Contains recognizeText, OCR_SCRIPT and parseOcr.
 */

/** Printed instead of text when this Windows has no recogniser for the user's languages. */
export const NO_RECOGNISER = '#no-recogniser';

/** How long one recognition may take. Measured well under a second for a full window. */
export const OCR_TIMEOUT_MS = 10_000;

/**
 * The longest side a picture may have. Windows' recogniser refuses larger images
 * (`OcrEngine.MaxImageDimension`, 10,000 on current Windows), and text this size reads well.
 */
export const OCR_MAX_LONG_SIDE = 2_500;

export const OCR_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { '${NO_RECOGNISER}'; exit 0 }
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$ms = New-Object System.IO.MemoryStream(,$bytes)
$stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
foreach ($line in $result.Lines) { $line.Text }
`;

/** Runs a script with data on its stdin and resolves with what it printed. */
export type RunWithInput = (script: string, timeoutMs: number, input: string) => Promise<string>;

/** The recognised lines, or nothing when there is no recogniser or the run failed. */
export function parseOcr(stdout: string): string {
  const text = stdout.replace(/\r\n/g, '\n').trim();
  return text === NO_RECOGNISER ? '' : text;
}

/** Reads the text in a PNG. Never rejects: a picture it could not read reads as empty. */
export async function recognizeText(run: RunWithInput, pngBase64: string): Promise<string> {
  try {
    return parseOcr(await run(OCR_SCRIPT, OCR_TIMEOUT_MS, pngBase64));
  } catch {
    return '';
  }
}
