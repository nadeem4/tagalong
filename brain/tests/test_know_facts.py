"""The pure rules for fact dates and category names: a year counts only when the source says it,
and a category never carries contact details or a personal topic.

No storage, no model.
"""

import pytest

from brain.know.facts import evidenced_span, normalise_category


def test_year_kept_when_in_evidence():
    assert evidenced_span("2019", None, "joined Acme in 2019") == ("2019", None)


def test_year_dropped_when_not_in_evidence():
    assert evidenced_span("2015", None, "joined Acme in 2019") == (None, None)


@pytest.mark.parametrize("evidence", ["since '19", "three years ago"])
def test_apostrophe_year_and_relative_do_not_count(evidence):
    assert evidenced_span("2019", None, evidence) == (None, None)


def test_end_now_needs_evidenced_start():
    assert evidenced_span("2019", "now", "Python since 2019") == ("2019", None)
    assert evidenced_span("2019", "NOW", "Python since 2019") == ("2019", None)
    assert evidenced_span("2018", "now", "Python since 2019") == (None, None)


def test_start_and_end_both_kept_when_evidenced():
    assert evidenced_span("2019", "2021", "worked there 2019 to 2021") == ("2019", "2021")


def test_end_year_not_in_evidence_drops_both():
    # Keeping the start alone would read as "still true", which the source did not say.
    assert evidenced_span("2019", "2024", "joined in 2019") == (None, None)


def test_start_after_end_drops_both():
    assert evidenced_span("2021", "2019", "from 2021 to 2019") == (None, None)


def test_end_without_start_is_dropped():
    assert evidenced_span(None, "2020", "left in 2020") == (None, None)


def test_non_year_values_ignored():
    assert evidenced_span("last spring", "x", "last spring") == (None, None)
    assert evidenced_span(2019, None, "in 2019") == (None, None)


def test_category_normalised():
    assert normalise_category("  machine   learning ") == "Machine Learning"
    assert len(normalise_category("a" * 40) or "") == 30


@pytest.mark.parametrize("name", ["a@b.com", "Family", "Home town", "Health", "", "  ", 7, None])
def test_category_dropped_for_contact_or_personal(name):
    assert normalise_category(name) is None
