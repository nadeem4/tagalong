/**
 * Connections: the person's apps over MCP. The manager keeps one client per switched-on
 * connection (a write waits as an ask, in ../asks, until the person allows it), and the
 * catalog and the Claude Code reader fill Home's Popular and Found on this PC lists.
 */
export { POPULAR_CONNECTORS } from './catalog';
export { readClaudeCodeConnectors } from './claude-code-config';
export { ConnectionManager, type TransportFor } from './manager';
export { ConnectionStore } from './store';
