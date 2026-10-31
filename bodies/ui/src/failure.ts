/**
 * A failed host call's own words. Contains failure. Electron wraps an IPC error as
 * "Error invoking remote method '<channel>': Error: <text>"; people should see only <text>.
 */

export function failure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
}
