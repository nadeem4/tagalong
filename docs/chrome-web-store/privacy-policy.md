# Tagalong for Chrome: privacy policy

Effective date: [EFFECTIVE DATE]

This policy covers the Tagalong browser extension. The extension works only with the Tagalong
brain, which runs on your computer or on another one you set up.

## What it reads

The extension reads a page only when Scout, the Tagalong companion, asks for it while you are
talking to Scout, and only after you allow it:

- Listing your tabs (title, address, whether each is active or asleep) needs your yes to
  "see open tabs".
- Reading a tab needs that, and your yes for the site: **Allow on this site**, **Allow on all
  sites** or **Not now**, in a small window the extension opens.

When it reads one tab, it takes the text you selected there, the page's URL and title, and the
page's main text with menus and footers removed, up to 40,000 characters. It does not wake a
sleeping tab, and it does not read Chrome's own pages, the Web Store or other extensions' pages.
No script runs in your pages until Scout asks and you have allowed it.

The toolbar button opens a popup that lists what you have allowed. You can also remove any of it
there, or on Chrome's extensions page.

## Where it goes

The extension sends what it read to the Tagalong brain, over one websocket, to the address you set
in the popup (`127.0.0.1:47321` by default). Its security policy lets it open websockets and
nothing else.

The brain then sends your question and what was attached to the AI service you chose in Tagalong,
to get an answer. There is no Tagalong server. We do not receive your data.

## What it stores

Only the brain's address, a name for this browser and a random id, in this browser's local
extension storage, and the number of the last message it received, in session storage that Chrome
clears when the browser closes. None of it is synced to other devices. Removing the extension
deletes it.

The extension keeps no pages and no conversations. Your conversations are stored by the Tagalong
brain.

## What it does not do

- It does not sell or share your data.
- It shows no ads.
- It does not track you or build a browsing history.
- It has no analytics and no crash reporting.
- It does not use your data for anything other than answering your own questions.

## Changes

If this policy changes, the new version will be posted here with a new effective date.

## Contact

Questions: [CONTACT EMAIL]
