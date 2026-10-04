import type { ConnectionStatus } from './engine-connection';

/** One sentence per connection state, shared by the options page and the side panel. */
export function describeStatus(status: ConnectionStatus): string {
  switch (status.state) {
    case 'unpaired':
      return 'Not paired. Paste the pairing token from Tagalong Settings in the extension options.';
    case 'connecting':
      return 'Connecting to the Tagalong app…';
    case 'connected':
      return `Connected to Tagalong ${status.engineVersion}.`;
    case 'disconnected':
      return `Disconnected: ${status.reason}. Retrying in ${Math.round(status.retryInMs / 1000)}s. Is the Tagalong app running?`;
    case 'rejected':
      return status.reason;
  }
}
