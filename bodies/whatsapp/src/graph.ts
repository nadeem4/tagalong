/**
 * Sends text and reply buttons through Meta's Graph API. One retry on a network error or a
 * 5xx, then it logs a line (never the token or the words) and gives up: no queue, and it never
 * throws, so a dead network cannot take the bridge down. Each send says whether it went.
 */

export const GRAPH_VERSION = 'v21.0';

export interface GraphOptions {
  phoneNumberId: string;
  accessToken: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export interface ReplyButton {
  id: string;
  title: string;
}

export function createGraph(options: GraphOptions): {
  sendText(to: string, text: string): Promise<boolean>;
  sendButtons(to: string, body: string, buttons: ReplyButton[]): Promise<boolean>;
} {
  const { phoneNumberId, accessToken, fetch: doFetch = fetch, log = () => undefined } = options;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

  // Returns a short reason when the send should be retried or has failed, else null.
  const attempt = async (payload: object): Promise<{ retry: boolean; why: string } | null> => {
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
      });
      if (res.ok) return null;
      return { retry: res.status >= 500, why: `status ${res.status}` };
    } catch {
      // The error text can echo the request, so it is not logged.
      return { retry: true, why: 'network error' };
    }
  };

  const send = async (payload: object): Promise<boolean> => {
    let failed = await attempt(payload);
    if (failed?.retry) failed = await attempt(payload);
    if (failed) log(`whatsapp send failed: ${failed.why}`);
    return failed === null;
  };

  return {
    sendText: (to, text) => send({ to, type: 'text', text: { body: text } }),
    sendButtons: (to, body, buttons) =>
      send({
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: { buttons: buttons.map((reply) => ({ type: 'reply', reply })) },
        },
      }),
  };
}
