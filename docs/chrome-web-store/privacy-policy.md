# Tagalong for Chrome: privacy policy

Effective date: [EFFECTIVE DATE]

This policy covers the Tagalong browser extension. The extension works only with the Tagalong
brain, which runs on your computer or on another one you set up.

## What it reads

The extension reads a page, takes a picture or searches your browser only when Scout, the Tagalong
companion, asks for it while you are talking to Scout, and only after you allow it. (The one
exception is an ask you make yourself from the page, described below.)

- Listing your tabs (title, address, whether each is active or asleep) needs your yes to
  "see open tabs".
- Reading a tab, or taking a picture of it, needs that, and your yes for the site: **Allow on this
  site**, **Allow on all sites** or **Not now**, in a small window the extension opens. A picture
  is of the visible part of the tab in front only.
- Searching your history, bookmarks, downloads, recently closed tabs or reading list needs your yes
  for that one source. It returns the matching entries (title, address and date, or the file name
  for a download), up to a small limit.
- Acting on your tabs (opening an address or a web search, closing, switching to or grouping tabs,
  reopening the one closed last, adding a bookmark or a reading list entry) happens only when Scout
  asks while you are talking to it. Tagalong asks you first in its bubble, every time, until you
  set this tool to auto in Home; the ones that need a browser permission then ask you for it the
  first time. It only opens web addresses (http and https). It does not read what a search returns.

When it reads one tab, it takes the text you selected there, the page's URL and title, and the
page's main text with menus and footers removed, up to 40,000 characters. It does not wake a
sleeping tab, and it does not read Chrome's own pages, the Web Store or other extensions' pages.
No script runs in your pages until Scout asks and you have allowed it.

Two small facts are sent without Scout asking, and only while the extension is connected to your
brain and you have allowed them: the title and address of the tab in front when it changes (needs
the "see open tabs" yes), and the name and outcome of a download that finishes or fails (needs the
downloads yes). The address is sent without its query string or fragment, and a private (incognito)
window is never reported. They are context for Scout, not a reason for it to speak.

You can also ask Scout from the page: select text, right-click and choose "Ask Scout about this"
(after you turn it on in the popup), or type `scout` and your question in the address bar. That
ask sends the text you typed, or the text you selected (at most 2,000 characters, marked to Scout
as page text and not as instructions), to your own brain, because you made the ask. The page's
title and address come with it only if you allowed "see open tabs"; a right-click still sends the
page's address. The address has no query string or fragment. Nothing more is read from the page,
and nothing is sent from a private (incognito) window.

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
- It does not track you or build a browsing history. The extension keeps no record of the tabs or
  downloads it reports.
- It has no analytics and no crash reporting.
- It does not use your data for anything other than answering your own questions.

## Changes

If this policy changes, the new version will be posted here with a new effective date.

## Contact

Questions: [CONTACT EMAIL]
