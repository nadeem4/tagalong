"""Tests for to_speakable, merge_short_lines and SpokenStream: what Scout says aloud.

Cases are ported from the desktop's speakable and spoken-stream tests, which this replaces.
"""

import pytest

from brain.voice.speakable import SpokenStream, merge_short_lines, to_speakable


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


def test_merge_short_lines_joins_short_ones():
    assert merge_short_lines(["Done.", "All green.", "Shall I push?"]) == [
        "Done. All green. Shall I push?"
    ]


def test_merge_short_lines_leaves_a_long_line_alone():
    long = "The tests passed on the first run, and the build is ready to ship."
    assert merge_short_lines([long, "Done."]) == [long, "Done."]
    assert merge_short_lines([]) == []


def stream():
    said: list[str] = []
    return said, SpokenStream(said.append)


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
