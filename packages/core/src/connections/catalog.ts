import type { PopularConnector } from '@tagalong/protocol';

/**
 * The official remote MCP servers Home offers with one Connect button. Only addresses the
 * vendor publishes itself are listed, each checked against the page named beside it.
 *
 * Google Calendar, Gmail and Docs have official remote servers (calendarmcp, gmailmcp and
 * docsmcp.googleapis.com), but only in a developer preview that needs your own Google Cloud
 * project and OAuth client, so they are not one-click and are left out.
 */
export const POPULAR_CONNECTORS: readonly PopularConnector[] = [
  {
    // https://developers.notion.com/docs/get-started-with-mcp
    id: 'notion',
    name: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    auth: 'oauth',
    blurb: 'Search and read your pages and databases.',
  },
  {
    // https://github.com/github/github-mcp-server: OAuth needs an app registered per host,
    // and every host is supported with a personal access token.
    id: 'github',
    name: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: 'token',
    blurb: 'Pull requests, reviews and issues waiting for you.',
    tokenHint: 'Paste a GitHub personal access token. Read-only access is enough to start.',
    tokenUrl: 'https://github.com/settings/personal-access-tokens/new',
  },
  {
    // https://linear.app/docs/mcp
    id: 'linear',
    name: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    auth: 'oauth',
    blurb: 'Your issues, projects and cycles.',
  },
];
