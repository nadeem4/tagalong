# The WhatsApp body

## Purpose

`bodies/whatsapp` is a small Node program that makes WhatsApp a body for the Python brain. You
message Scout from your phone; the bridge says it to the brain over contract v1 and sends Scout's
finished answer back to the same chat. It holds no brain of its own and adds no frame to the
contract: it is an ordinary body whose `kind` is `whatsapp`. This page covers the bridge core
(webhook, send, window). Asks as buttons and the Home setup come in later slices.

## Flow

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#ffffff','primaryTextColor':'#000000','primaryBorderColor':'#000000','lineColor':'#000000'}}}%%
flowchart LR
  P[Phone] --> M[Meta Cloud API]
  M -->|HTTPS webhook| F[Public tunnel]
  F --> B[Bridge, started by the brain]
  B -->|say, loopback| R[Brain, always on]
  R -->|reply| B
  B -->|Graph API send| M
  M --> P
```

The brain starts and watches the bridge (`brain/src/brain/bridges.py`, see [brain.md](brain.md)). It
gives the bridge its settings as environment variables and holds a stdin pipe open. When that pipe
closes the brain is gone, so the bridge exits; a hard kill of the brain therefore leaves no bridge
behind. The bridge prints its log lines on stdout, which the brain writes to `brain.log` through its
secret filter.

## Identity and context

- Hello: `{"protocol":1,"body":{"id":"whatsapp","kind":"whatsapp","name":"WhatsApp"},"tools":[]}`. No
  tools and no `display: false`, so the brain counts it as a body that shows answers.
- Each text becomes `say` with `context: {channel: "whatsapp", note: "text chat on a phone; keep replies short and offer detail on request"}`.
- A `reply` is kept only when its `body` is `whatsapp`, buffered per turn and sent at `done`. A reply
  for another body is ignored. If the brain is down when you write, the message is logged and nothing
  is sent to the phone.
- Voice notes and images from you are ignored without a word in this version.

## The webhook

Only `/webhook` exists (anything else is 404). The bridge listens on `127.0.0.1:<port>` and the tunnel
you set up reaches it; the brain's own socket is never public.

| Request         | Rule                                                                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`           | `hub.verify_token` must equal the verify token, then the challenge is echoed with 200; else 403                                                                                                                                          |
| `POST`          | the raw body is read up to about 1 MB (over it: 413), then `X-Hub-Signature-256` is checked as `sha256=` plus the HMAC-SHA256 of the raw body with the app secret, in constant time, **before any JSON parsing** (missing or wrong: 401) |
| after the check | 200 at once, then each text message from the allowed number whose id was not seen before is handed to the bridge; statuses, other senders, other message types and repeated ids are dropped                                              |

The seen ids are kept in memory (the last 1000), so a restart forgets them; a Meta retry after a
restart could in theory say the same text twice.

## Sending, splitting and the 24-hour window

- `graph.ts` posts to `https://graph.facebook.com/v21.0/<phone number id>/messages` (`GRAPH_VERSION`
  is the one constant to change) with the access token as a bearer token. One retry on a network
  error or a 5xx, then it logs a line without the token or the text and gives up. There is no queue.
- `split.ts` cuts a reply at about 4000 characters (WhatsApp allows 4096), at a blank line, else a
  line, else a space, else hard. The four-message cap and the cut note arrive with asks.
- `window.ts`: WhatsApp allows free text only for 24 hours after your last message. If a reply
  finishes after that, it is dropped with one log line; the desktop chat still shows it.

## Settings the bridge reads

Passed by the brain, never from `.env`: `TAGALONG_WHATSAPP_ACCESS_TOKEN`, `_APP_SECRET`, `_VERIFY_TOKEN`,
`_PHONE_NUMBER_ID`, `_ALLOWED_NUMBER`, `_PORT` (default 47322) and `TAGALONG_BRAIN_ADDR` (default
`127.0.0.1:47321`). A missing value stops the bridge with a plain message that names the variable and
never shows a value.

## Files

| File                            | Responsibility                                                      |
| ------------------------------- | ------------------------------------------------------------------- |
| `bodies/whatsapp/src/config.ts` | `readConfig`: the settings above                                    |
| `src/webhook.ts`                | the signed webhook server                                           |
| `src/graph.ts`                  | the Graph send                                                      |
| `src/split.ts`                  | `splitReply`                                                        |
| `src/window.ts`                 | the 24-hour window                                                  |
| `src/bridge.ts`                 | `createBridge`: the contract v1 body                                |
| `src/index.ts`                  | the entry: real websocket, stdin pipe, SIGTERM                      |
| `vite.config.ts`                | bundles everything (contract and zod included) into `dist/index.js` |

## Build and test

```bash
pnpm --filter @tagalong/whatsapp build   # writes bodies/whatsapp/dist/index.js, one file
pnpm --filter @tagalong/whatsapp test
```

`pnpm dev:desktop` builds it too, so the brain finds `dist/index.js`. Tests use only fakes: a fake
brain socket, a fake `fetch` for the Graph API, a movable clock and locally signed webhook requests.
No Meta or network call is made.
