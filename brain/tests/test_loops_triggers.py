"""Tests for the pure trigger rules: context matching, due, urgent, quiet and stale."""

from datetime import UTC, datetime, timedelta

import pytest

from brain.loops.loop import Loop
from brain.loops.triggers import context, due, quiet, stale, urgent

T0 = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)


def lp(**kw):
    kw.setdefault("source", "gmail")
    kw.setdefault("ref", "a")
    kw.setdefault("title", "t")
    kw.setdefault("asks", "x")
    return Loop(**kw)


# --- context ---


def test_file_title_matches_a_deck_anchor_by_tokens():
    assert context.matches("Q4 pricing deck", "Q4 pricing.pptx - PowerPoint")


def test_file_anchor_matches_the_file_name():
    assert context.matches("Q4 pricing.pptx", "Q4 pricing.pptx - PowerPoint")
    assert context.matches("Q4 pricing.pptx", "Q4-pricing.pptx")


def test_case_and_punctuation_are_ignored():
    assert context.matches("q4, PRICING deck!", "Q4 Pricing (draft)")


@pytest.mark.parametrize("anchor", ["Priya", "pricing", "", "  "])
def test_a_one_token_anchor_never_matches(anchor):
    assert not context.matches(anchor, "Priya pricing notes")


@pytest.mark.parametrize(
    "anchor", ["Untitled", "Document1", "New Tab", "Inbox", "Home", "Untitled document"]
)
def test_stoplist_anchors_never_match(anchor):
    assert not context.matches(anchor, anchor)


def test_one_shared_token_is_not_enough():
    assert not context.matches("Q4 pricing deck", "Q4 budget")


def test_most_of_a_long_anchor_must_be_shared():
    assert not context.matches("meeting notes with Priya about hiring", "Meeting notes")


def test_stoplist_words_do_not_count_as_shared():
    assert not context.matches("new pricing deck", "New Tab - pricing")


def test_url_matches_by_host_and_path_prefix_ignoring_query():
    anchor = "https://docs.example.com/q4-pricing"
    assert context.matches(anchor, "", "https://docs.example.com/q4-pricing/edit?x=1#top")
    assert context.matches(anchor, "", "https://www.docs.example.com/q4-pricing?x=1")
    assert not context.matches(anchor, "", "https://docs.example.com/q4-pricing-old")
    assert not context.matches(anchor, "", "https://docs.example.com/other")


def test_a_host_only_url_anchor_never_matches():
    assert not context.matches("https://docs.example.com/", "", "https://docs.example.com/a")


def test_mail_in_front():
    assert context.mail_in_front("chrome.exe", "Inbox (3) - me@gmail.com - Gmail", "")
    assert context.mail_in_front("OUTLOOK.EXE", "Re: pricing", "")
    assert context.mail_in_front("", "Re: pricing", "https://mail.google.com/mail/u/0/#inbox")
    assert not context.mail_in_front("POWERPNT.EXE", "Q4 pricing.pptx", "")


def test_find_returns_the_first_matching_anchor():
    loop = lp(anchors=["Budget 2027 plan", "Q4 pricing deck"])
    assert context.find(loop, "Q4 pricing.pptx", "") == "Q4 pricing deck"
    assert context.find(loop, "Solitaire", "") is None


# --- due ---


def test_due_pending_is_unfired_sorted_by_time():
    a = lp(ref="a", due=T0 + timedelta(hours=2))
    b = lp(ref="b", due=T0 + timedelta(hours=1))
    fired = lp(ref="c", due=T0)
    fired.surfaced[due.anchor(fired)] = "2026-11-04"
    assert [x.ref for x in due.pending([a, b, fired])] == ["b", "a"]


# --- urgent ---


def test_urgent_fires_once_per_loop():
    assert urgent.fresh(lp(), True)
    assert not urgent.fresh(lp(surfaced={urgent.ANCHOR: "2026-11-04"}), True)
    assert not urgent.fresh(lp(), False)


# --- quiet ---


def test_quiet_needs_they_owe_and_a_passed_quiet_after():
    ripe = lp(ref="a", direction="they_owe", quiet_after=T0 - timedelta(hours=1))
    future = lp(ref="b", direction="they_owe", quiet_after=T0 + timedelta(hours=1))
    mine = lp(ref="c", direction="i_owe", quiet_after=T0 - timedelta(hours=1))
    none = lp(ref="d", direction="they_owe")
    assert [x.ref for x in quiet.ripe([ripe, future, mine, none], T0)] == ["a"]


def test_quiet_fires_once_per_quiet_time():
    loop = lp(direction="they_owe", quiet_after=T0 - timedelta(hours=1))
    loop.surfaced[quiet.anchor(loop)] = "2026-11-04"
    assert quiet.ripe([loop], T0) == []


# --- stale ---


def test_stale_is_held_and_untouched_for_n_days():
    old = lp(ref="a", updated=T0 - timedelta(days=8))
    fresh = lp(ref="b", updated=T0 - timedelta(days=2))
    snoozed = lp(ref="c", updated=T0 - timedelta(days=30), status="snoozed")
    assert [x.ref for x in stale.ripe([old, fresh, snoozed], T0, 7)] == ["a"]
