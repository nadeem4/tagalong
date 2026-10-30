# Chrome Web Store listing

Everything to paste into the Chrome Web Store developer dashboard for the Tagalong browser body, plus
the steps to submit it. Each claim here matches the code in `bodies/browser/src` and the manifest in
`bodies/browser/src/manifest.ts`. The public privacy policy is in
[privacy-policy.md](privacy-policy.md).

## Before you submit: two gaps in the package

- **There is no icon.** The manifest has no `icons` or `action.default_icon` entry, and the build
  ships no image. The store needs a 128x128 icon, and Chrome shows a plain letter without one. Add
  icons (16, 32, 48, 128) to the manifest before the first upload.
- **The manifest description is the short description below.** The store takes the summary from
  the manifest `description`; keep the two the same.

## Store listing

**Name:** Tagalong

**Short description** (120 of 132 characters; the manifest `description` is the same text):

> Lets Scout, your Tagalong companion, read pages in your browser only when it needs to. Needs the Tagalong brain running.

**Detailed description** (paste as is; each paragraph is one line):

```text
This extension needs the Tagalong brain, running on your computer or another one you trust. On its own it does nothing.

Tagalong is a desktop companion. Scout sees what you are working on, answers questions, and hands bigger jobs to experts such as Claude Code. This extension lets Scout look at your browser tabs.

What it does:
- Lets Scout list your open tabs: title, address, which one is active, which are asleep.
- Lets Scout read the text of one tab, and any text you selected on it, when you ask Scout about it.

How it works:
- Ask Scout about your tabs ("what tabs do I have open?", "read this page").
- The first time Scout needs something, a small window asks you. Choose Allow on this site, Allow on all sites, or Not now.
- The toolbar button shows whether Scout's brain is reachable, lets you change its address, name this browser, and see or remove what you allowed.

Setup: load the extension, then start the Tagalong brain. There is nothing to paste: the extension finds the brain at 127.0.0.1:47321, or at the address you set in the toolbar popup.

Privacy:
- Reads a page only when Scout asks and you allowed it. Nothing runs in pages in the background.
- Talks only to the Tagalong brain at the address you set (127.0.0.1 unless you change it). There is no Tagalong server.
- The brain sends your question and what you attached to the AI service you chose in Tagalong.
- No ads, no analytics, no tracking. Nothing sold.
```

**Category:** Productivity. (Tools is the other fit. Productivity matches what people search for.)

**Language:** English.

## Privacy practices tab

### Single purpose

> Lets Scout, the Tagalong companion, list the user's open tabs and read the text of a tab the user
> allows, when the user asks. It connects only to the user's Tagalong brain.

### Permission justifications

One entry per permission in the manifest.

| Permission                                                                                             | Justification                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alarms`                                                                                               | A 30-second alarm wakes the service worker after Chrome stops it, so the extension notices when the Tagalong brain starts again and reconnects.                                       |
| `scripting`                                                                                            | Injects the bundled page reader into one tab only when Scout asks and the user allowed that site, to read its selection and main text. There is no standing content script.           |
| `storage`                                                                                              | Keeps the brain's address, the browser's name and its random body id, in `chrome.storage.local`, and the last message number in `chrome.storage.session`. Never synced.               |
| `tabs` (optional)                                                                                      | Asked on first use, from a click in a small window. Lets Scout see the title and address of open tabs.                                                                                |
| `history`, `bookmarks`, `downloads`, `sessions`, `readingList`, `tabGroups`, `contextMenus` (optional) | Declared so later tools can ask for them. Nothing uses them yet; each is asked, from a click, the first time a tool needs it.                                                         |
| `<all_urls>` host (optional)                                                                           | Off until the user picks Allow on this site or Allow on all sites in the permission window. Lets the extension read a tab of that site when Scout asks. It reads nothing until asked. |

### Remote code

> No, I am not using remote code.

All JavaScript is bundled in the package. The manifest's content security policy allows scripts
only from the extension itself (`script-src 'self'`) and network connections only to
`ws:` (websockets only).

### Data usage

What the extension handles, from the code:

- tab titles and addresses, when Scout lists tabs and the user allowed it.
- text you select, the page's main text (capped at 40,000 characters), page URL and title. Read
  only when Scout asks and the user allowed that site.
- the brain's address, a name for the browser and a random body id, stored locally.

All of it goes to the Tagalong brain the user set up, over a websocket (`ws://127.0.0.1:47321` by
default). The brain sends the question and what was attached to the AI service the user chose in
Tagalong. The developer runs no server and receives nothing.

Tick these categories:

| Category                                                         | Tick | Why                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website content                                                  | Yes  | Selected text and page text.                                                                                                                                                                                                                   |
| Web history                                                      | Yes  | The URL and title of the tab you ask about are sent with the page, and tab titles and addresses when Scout lists tabs. It is the tabs you ask about, on request, not your browsing history. Ticking it is the cautious choice; owner decision. |
| Personal communications                                          | No   | The extension does not read email or messages as such. If you select text in a web mail page, that is website content.                                                                                                                         |
| Authentication information                                       | No   | No pairing token or key is stored. No user passwords or site credentials are read.                                                                                                                                                             |
| Personally identifiable information, health, financial, location | No   | Not read.                                                                                                                                                                                                                                      |
| User activity                                                    | No   | No click, keystroke, scroll or mouse monitoring.                                                                                                                                                                                               |

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

| Image            | Size     | Format      | What it shows                                                                                                           |
| ---------------- | -------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| Store icon       | 128x128  | PNG         | The Tagalong mark (Scout), 96x96 artwork with 16 px transparent padding. The same file belongs in the manifest `icons`. |
| Screenshot 1     | 1280x800 | PNG or JPEG | The toolbar popup: "Connected to Scout's brain", the address, the browser name and the allowed list.                    |
| Screenshot 2     | 1280x800 | PNG or JPEG | The permission window asking to read a page, with Allow on this site, Allow on all sites and Not now.                   |
| Screenshot 3     | 1280x800 | PNG or JPEG | The Tagalong bubble answering a question about the open tabs, next to the browser.                                      |
| Screenshot 4     | 1280x800 | PNG or JPEG | Home -> Settings -> Add Scout to your browser beside chrome://extensions with Load unpacked. Optional.                  |
| Small promo tile | 440x280  | PNG or JPEG | The Tagalong mark and the name, with one line: "Needs the Tagalong brain." No screenshot.                               |

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
   `bodies/browser/src/manifest.ts` (today `0.0.0`; for example `0.1.0`). Every later upload needs
   a higher version than the last one.
5. Build: `pnpm --filter @tagalong/browser build`.
6. Zip the **contents** of `bodies/browser/dist`, so `manifest.json` sits at the root of the zip,
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
