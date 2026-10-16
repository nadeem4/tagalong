# Chrome Web Store listing

Everything to paste into the Chrome Web Store developer dashboard for the Tagalong extension, plus
the steps to submit it. Each claim here matches the code in `apps/extension/src` and the manifest in
`apps/extension/src/manifest.ts`. The public privacy policy is in
[privacy-policy.md](privacy-policy.md).

## Before you submit: two gaps in the package

- **There is no icon.** The manifest has no `icons` or `action.default_icon` entry, and the build
  ships no image. The store needs a 128x128 icon, and Chrome shows a plain letter without one. Add
  icons (16, 32, 48, 128) to the manifest before the first upload.
- **The manifest description is the short description below.** The store takes the summary from
  the manifest `description`; keep the two the same.

## Store listing

**Name:** Tagalong

**Short description** (128 of 132 characters):

> Hands Scout, your Tagalong companion, your selection and the page you are on. Needs the Tagalong
> desktop app running on Windows.

**Detailed description** (paste as is; each paragraph is one line):

```text
This extension needs the Tagalong desktop app for Windows, running on the same computer. On its own it does nothing.

Tagalong is a desktop companion. Scout sees what you are working on, answers questions, and hands bigger jobs to experts such as Claude Code. This extension lets Scout read the browser properly.

What it does:
- Gives Scout the exact text you selected on a page, not a copy through the clipboard.
- Reads the main text of the page you are on, with menus and footers stripped, when you ask.
- Puts Scout in Chrome's side panel, with the same memory and settings as the desktop app.

How it works:
- Click the toolbar button to open the side panel beside the page.
- Or select text and press Alt+Shift+Space.
- Or press the desktop hotkey Ctrl+Shift+Space while Chrome is in front.
The side panel shows what is attached before you send, and Clear removes it.

Setup: copy the pairing token from Tagalong Settings > Browser extension and paste it into the extension's options page. You do this once.

Privacy:
- It reads a page only when you use it there. Nothing runs in your pages until you ask.
- It talks only to the Tagalong app on this computer, at 127.0.0.1. It cannot connect anywhere else.
- The Tagalong app sends your question and what you attached to the AI service you chose in Tagalong. There is no Tagalong server.
- No ads, no analytics, no tracking. Nothing is sold.
```

**Category:** Productivity. (Tools is the other fit. Productivity matches what people search for.)

**Language:** English.

## Privacy practices tab

### Single purpose

> Lets the Tagalong desktop app on this computer read the text you select, and the page you ask
> about, and shows the Tagalong chat in Chrome's side panel. It connects only to the Tagalong app
> on 127.0.0.1.

### Permission justifications

One entry per permission in the manifest.

| Permission                   | Justification                                                                                                                                                                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`                  | Reads the tab the user acted on (toolbar button, keyboard shortcut or side panel) so Scout gets the exact selection and page text. Used instead of host permissions, so no page is readable until the user acts on it.                                                                  |
| `alarms`                     | A 30-second alarm wakes the service worker after Chrome stops it, so the extension notices when the Tagalong desktop app starts again and reconnects to it on 127.0.0.1.                                                                                                                |
| `scripting`                  | Injects the bundled page reader into the active tab only when the user asks, to read the selection and the page's main text. There is no standing content script.                                                                                                                       |
| `sidePanel`                  | Shows the Tagalong chat in Chrome's side panel beside the page, and opens it from the toolbar button and the shortcut.                                                                                                                                                                  |
| `storage`                    | Keeps the pairing token and port the user pastes on the options page, in `chrome.storage.local` only. Never synced.                                                                                                                                                                     |
| `<all_urls>` host (optional) | Off by default. The user turns it on from the options page with "Allow reading any tab when I ask". It lets the extension read the tab in front when the user asks from a tab it was never clicked on, for example with the desktop hotkey. It still reads nothing until the user asks. |

### Remote code

> No, I am not using remote code.

All JavaScript is bundled in the package. The manifest's content security policy allows scripts
only from the extension itself (`script-src 'self'`) and network connections only to
`ws://127.0.0.1:*`.

### Data usage

What the extension handles, from the code:

- The text you select, the page's main text (capped at 40,000 characters), the page URL and title.
  Read only when you use the extension on that tab.
- Your question, typed in the side panel.
- The pairing token and port, stored locally.

All of it goes to the Tagalong app on this computer over `ws://127.0.0.1`. The app sends the
question and what was attached to the AI service the user chose in Tagalong. The developer runs no
server and receives nothing.

Tick these categories:

| Category                                                         | Tick | Why                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website content                                                  | Yes  | Selected text and page text.                                                                                                                                                        |
| Web history                                                      | Yes  | The URL and title of the tab you ask about are sent with the page. It is one page at a time, on request, not a browsing history. Ticking it is the cautious choice; owner decision. |
| Personal communications                                          | No   | The extension does not read email or messages as such. If you select text in a web mail page, that is website content.                                                              |
| Authentication information                                       | No   | The pairing token is the extension's own key to the local app. It stays in local extension storage and goes only to 127.0.0.1. No user passwords or site credentials are read.      |
| Personally identifiable information, health, financial, location | No   | Not read.                                                                                                                                                                           |
| User activity                                                    | No   | No click, keystroke, scroll or mouse monitoring.                                                                                                                                    |

Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

The first one holds because the only onward transfer is to the AI service the user picked, to
answer the user's own question. That is the approved use case of providing the item's feature.

**Privacy policy URL:** the public URL of [privacy-policy.md](privacy-policy.md). See
[Hosting the privacy policy](#hosting-the-privacy-policy).

## Images

Do not reuse desktop screenshots that show other windows' contents or real secrets.

| Image            | Size     | Format      | What it shows                                                                                                               |
| ---------------- | -------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| Store icon       | 128x128  | PNG         | The Tagalong mark (Scout), 96x96 artwork with 16 px transparent padding. The same file belongs in the manifest `icons`.     |
| Screenshot 1     | 1280x800 | PNG or JPEG | A real article in Chrome with the side panel open, connected, Scout answering and the sight bar naming the attached page.   |
| Screenshot 2     | 1280x800 | PNG or JPEG | Text selected on a page, the panel opened with `Alt+Shift+Space`, the exact selection in the sight bar, and Scout's answer. |
| Screenshot 3     | 1280x800 | PNG or JPEG | The options page: the pairing form, "Connected to Tagalong", and the "Reading tabs" section.                                |
| Screenshot 4     | 1280x800 | PNG or JPEG | The desktop app and Chrome side by side, so it is plain the extension works with the desktop app. Optional.                 |
| Small promo tile | 440x280  | PNG or JPEG | The Tagalong mark and the name, with one line: "Needs the Tagalong desktop app." No screenshot.                             |

The store needs the icon and at least one screenshot. Make the small promo tile too; the
dashboard asks for it.

## Visibility

Start with **Unlisted**. Only people with the link can install it. Move to Public once the desktop
installer is public and the extension has been used for a while.

## Submission steps

1. Register as a Chrome Web Store developer at
   <https://chrome.google.com/webstore/devconsole> with the Google account that will own the item.
   Pay the one-time US$5 fee.
2. Turn on 2-Step Verification on that Google account. The store requires it before you can
   publish.
3. In the dashboard's **Account** tab, set and verify the contact email. Publishing is blocked
   until it is verified.
4. In the repo, add the icons to the manifest (see the top of this page) and bump `version` in
   `apps/extension/src/manifest.ts` (today `0.0.0`; for example `0.1.0`). Every later upload needs
   a higher version than the last one.
5. Build: `pnpm --filter @tagalong/extension build`.
6. Zip the **contents** of `apps/extension/dist`, so `manifest.json` sits at the root of the zip,
   not inside a folder.
7. In the dashboard, click **New item** and upload the zip.
8. Fill in **Store listing**, **Privacy practices** and **Distribution** from this page. Set
   visibility to Unlisted.
9. Click **Submit for review**. Review usually takes a few days.

## Hosting the privacy policy

The store needs a public URL for the policy. Steps for GitHub Pages from this repo. Nothing has
been enabled.

The repo is **private**. GitHub Pages from a private repo needs a paid GitHub plan (Pro or above),
and the published site is still public. If that does not suit, copy `privacy-policy.md` into a
small public repo and follow the same steps there.

1. Fill in the `[CONTACT EMAIL]` and `[EFFECTIVE DATE]` placeholders in `privacy-policy.md` and
   merge.
2. On GitHub, open the repo's **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Pick branch `main` and folder `/docs`. Save.
5. Wait for the Pages build to finish. The policy is then at
   `https://nadeem4.github.io/tagalong/chrome-web-store/privacy-policy.html` (GitHub renders the
   Markdown file as HTML).
6. Open that URL in a private window to check it loads, then paste it into the dashboard's privacy
   policy field.

Publishing from `/docs` makes every file in `docs/` public. If you only want the policy public,
use the separate public repo instead.
