/**
 * Sends text through Meta's Graph API. One retry on a network error or a 5xx, then it logs a
 * line (never the token or the words) and gives up: no queue, and it never throws, so a dead
 * network cannot take the bridge down.
 */

export const GRAPH_VERSION = 'v21.0';

export interface GraphOptions {
  phoneNumberId: string;
  accessToken: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export function createGraph(options: GraphOptions): {
  sendText(to: string, text: string): Promise<void>;
} {
  const { phoneNumberId, accessToken, fetch: doFetch = fetch, log = () => undefined } = options;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

  // Returns a short reason when the send should be retried or has failed, else null.
  const attempt = async (
    to: string,
    text: string,
  ): Promise<{ retry: boolean; why: string } | null> => {
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      });
      if (res.ok) return null;
      return { retry: res.status >= 500, why: `status ${res.status}` };
    } catch {
      // The error text can echo the request, so it is not logged.
      return { retry: true, why: 'network error' };
    }
  };

  return {
    async sendText(to, text) {
      let failed = await attempt(to, text);
      if (failed?.retry) failed = await attempt(to, text);
      if (failed) log(`whatsapp send failed: ${failed.why}`);
    },
  };
}
