"""Tests for to_speakable and SpokenStream: what Scout says aloud.

Cases are ported from the desktop's speakable and spoken-stream tests, which this replaces.
"""

import pytest

from brain.voice.speakable import SpokenStream, to_speakable


@pytest.mark.parametrize(
    ("text", "spoken"),
    [
        ("It’s in the bubble.\n> Bonjour.", "It’s in the bubble."),
        ("> Bonjour.\n> Ça va ?", ""),
        (
            "The build failed:\n> TypeError: x\nAn import is missing.",
            "The build failed: An import is missing.",
        ),
        ("The build is green.", "The build is green."),
        (
            "## Result\n**Done.** Run `pnpm test` per [the guide](https://x.dev).",
            "Result Done. Run pnpm test per the guide.",
        ),
        ("Here is the fix.\n```ts\nconst a = 1;\n```", "Here is the fix."),
        ("Two prices:\n| a | 1 |\n| b | 2 |", "Two prices:"),
        ("Three things:\n- one\n- two\n- three", "Three things: one two three"),
        ("Steps:\n1. open\n2. save", "Steps: open save"),
        ("Options:\n• fast\n• slow", "Options: fast slow"),
        ("See https://example.com/a/b for details.", "See for details."),
        ("```\nonly code\n```", ""),
        ("   ", ""),
    ],
)
def test_to_speakable(text, spoken):
    assert to_speakable(text) == spoken


def test_to_speakable_says_every_sentence_of_a_long_answer():
    long = f"{'word ' * 100}end."
    assert to_speakable(long) == long


def stream():
    said: list[str] = []
    paragraphs: list[bool] = []

    def say(line: str, paragraph_end: bool) -> None:
        said.append(line)
        paragraphs.append(paragraph_end)

    s = SpokenStream(say)
    s.paragraphs = paragraphs  # type: ignore[attr-defined]
    return said, s


def test_first_sentence_is_said_before_the_answer_ends():
    said, s = stream()
    s.push("Sure, it")
    assert said == []
    s.push("’s a test runner. It")
    assert said == ["Sure, it’s a test runner."]
    s.push("’s set up already.")
    assert said == ["Sure, it’s a test runner."]  # the last stop may be "3." of "3.5"
    s.end()
    assert said == ["Sure, it’s a test runner.", "It’s set up already."]


def test_splits_on_question_exclamation_and_line_break():
    said, s = stream()
    s.push("Got it! Want me to open it?\nOr leave it")
    s.end()
    assert said == ["Got it!", "Want me to open it?", "Or leave it"]


def test_never_says_code_even_when_the_fence_arrives_in_pieces():
    said, s = stream()
    s.push("Here’s the fix.\n``")
    s.push("`ts\nconst a = 1. b = 2.\n")
    s.push("```\nThat should do it.")
    s.end()
    assert said == ["Here’s the fix.", "That should do it."]


def test_an_unclosed_fence_is_never_said():
    said, s = stream()
    s.push("Here's the fix.\n``")
    s.push("`ts\nconst a = 1; const b = 2.\n")
    s.push("Thanks!\n``")
    s.push("`")
    s.end()
    assert said == ["Here's the fix."]


def test_list_items_are_read_without_markers():
    said, s = stream()
    s.push("Two steps.\n- run **pnpm** install\n- run the tests\n")
    s.end()
    assert said == ["Two steps.", "run pnpm install", "run the tests"]


def test_every_sentence_of_a_list_item_and_no_table_row():
    said, s = stream()
    s.push("Two steps.\n1. Install it. Then wait.\n2. Run ")
    s.push("the tests.\n• Or bar.\n| a. b. |\nThat’s all.")
    s.end()
    assert said == [
        "Two steps.",
        "Install it.",
        "Then wait.",
        "Run the tests.",
        "Or bar.",
        "That’s all.",
    ]


def test_a_list_marker_arriving_in_pieces_is_dropped():
    said, s = stream()
    s.push("Here.\n1")
    s.push(". Install")
    s.push(" it. Then go.\nDone.")
    s.end()
    assert said == ["Here.", "Install it.", "Then go.", "Done."]


def test_a_line_that_only_starts_like_a_number_is_read():
    said, s = stream()
    s.push("3.5 seconds, roughly. ")
    s.push("Fast enough.")
    s.end()
    assert said == ["3.5 seconds, roughly.", "Fast enough."]


def test_all_blocks_say_nothing():
    for text in ("```\ncode only\n```", "> Bonjour.\n> Merci."):
        said, s = stream()
        s.push(text)
        s.end()
        assert said == []


def test_a_quote_marker_arriving_alone_still_hides_the_line():
    said, s = stream()
    s.push("It’s in the bubble.\n")
    s.push(">")
    s.push(" Bonjour. Ça va ?")
    s.push(" Très bien.\n> Merci.\nThat’s")
    s.push(" all of it.")
    s.end()
    assert said == ["It’s in the bubble.", "That’s all of it."]


def test_nothing_is_said_after_end():
    said, s = stream()
    s.push("Done.")
    s.end()
    s.push(" More.")
    s.end()
    assert said == ["Done."]


def test_divider_ends_the_spoken_part():
    said, s = stream()
    s.push("Found it. Two files changed.\n\n---\n\n- a.py\n- b.py\n")
    s.end()
    assert said == ["Found it.", "Two files changed."]


def test_divider_split_across_deltas():
    said, s = stream()
    s.push("Done. Look below.\n\n-")
    s.push("--\n\n| a | b |")
    s.end()
    assert said == ["Done.", "Look below."]


def test_divider_first_says_nothing():
    said, s = stream()
    s.push("---\n\nhere is a list")
    s.end()
    assert said == []


def test_second_divider_changes_nothing():
    said, s = stream()
    s.push("Hi there.\n\n---\n\nMore.\n\n---\n\nEven more prose here.")
    s.end()
    assert said == ["Hi there."]


def test_a_rule_inside_a_sentence_is_not_a_divider():
    said, s = stream()
    s.push("It costs 5---maybe 6. Fine.")
    s.end()
    assert said == ["It costs 5---maybe 6.", "Fine."]


def test_lead_in_then_divider_in_a_later_step():
    said, s = stream()
    for delta in ("Let me check.", "\n\n", "It is green.\n\n---\n\nlog: ok"):
        s.push(delta)
    s.end()
    assert said == ["Let me check.", "It is green."]


def test_a_divider_at_the_very_end_says_only_the_spoken_part():
    said, s = stream()
    s.push("Hi.\n\n---")
    s.end()
    assert said == ["Hi."]


@pytest.mark.parametrize("tail", ["--", "-"])
def test_a_half_divider_at_the_end_is_not_said(tail):
    said, s = stream()
    s.push(f"Hi.\n\n{tail}")
    s.end()
    assert said == ["Hi."]


def test_a_list_marker_then_its_item_is_still_spoken():
    said, s = stream()
    s.push("- ")
    s.push("apples\n")
    s.end()
    assert said == ["apples"]

@pytest.mark.parametrize(
    ("text", "sentences"),
    [
        ("Use e.g. Python. Then stop.", ["Use e.g. Python.", "Then stop."]),
        ("Ask Dr. Smith about it. Okay.", ["Ask Dr. Smith about it.", "Okay."]),
        ("It is 3.5 percent. Fine.", ["It is 3.5 percent.", "Fine."]),
        ("Version v1.2.3 is out. Update.", ["Version v1.2.3 is out.", "Update."]),
        ("I waited... then left. Bye.", ["I waited... then left.", "Bye."]),
        ("Ask J. Smith. Then go.", ["Ask J. Smith.", "Then go."]),
        ("Line one\nstill line one. Next.", ["Line one still line one.", "Next."]),
        ("Wait. What?! Really.", ["Wait.", "What?!", "Really."]),
        ('She said "stop." Then left.', ['She said "stop."', "Then left."]),
        ("Hello world.", ["Hello world."]),
        ("Mind etc. Then more. Fine.", ["Mind etc. Then more.", "Fine."]),
    ],
)
def test_find_sentence_end(text, sentences):
    said, s = stream()
    s.push(text)
    s.end()
    assert said == sentences


def test_a_blank_line_ends_the_sentence_and_the_paragraph():
    said, s = stream()
    s.push("First paragraph.\n\nSecond one here.")
    s.end()
    assert said == ["First paragraph.", "Second one here."]
    assert s.paragraphs == [True, False]  # type: ignore[attr-defined]


def test_a_blank_line_ends_a_sentence_with_no_mark():
    said, s = stream()
    s.push("A heading line\n\nThen text here.")
    s.end()
    assert said == ["A heading line", "Then text here."]
    assert s.paragraphs[0] is True  # type: ignore[attr-defined]


def test_a_sentence_mark_at_the_very_end_waits_for_more():
    said, s = stream()
    s.push("It is done. ")
    assert said == []
    s.push("Next")
    assert said == ["It is done."]
