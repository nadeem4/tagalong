"""Tests for the Chunker: sentences grouped into the chunks the voice speaks whole."""

from brain.voice.chunker import MAX_WORDS, Chunk, Chunker


def make():
    out: list[Chunk] = []
    return out, Chunker(out.append)


def words(n: int, tag: str = "w") -> str:
    return " ".join([tag] * n) + "."


def count(chunk: Chunk) -> int:
    return len(chunk.text.split())


def test_first_sentence_goes_out_alone():
    out, c = make()
    c.push("Sure, I can look.")
    assert [k.text for k in out] == ["Sure, I can look."]


def test_first_sentence_under_four_words_waits():
    out, c = make()
    c.push("Okay.")
    assert out == []
    c.push("I found two files.")
    assert [k.text for k in out] == ["Okay. I found two files."]


def test_later_sentences_group_to_the_target():
    out, c = make()
    c.push("Sure, I can look.")
    for _ in range(10):
        c.push(words(8))
    c.end()
    sizes = [count(k) for k in out[1:]]
    assert all(24 <= n <= 45 for n in sizes[:-1])
    assert sum(sizes) == 80


def test_a_sentence_that_would_pass_the_max_starts_the_next_chunk():
    out, c = make()
    c.push("Sure, I can look.")
    c.push(words(20))
    c.push(words(40))
    c.end()
    assert [count(k) for k in out[1:]] == [20, 40]


def test_paragraph_end_flushes():
    out, c = make()
    c.push("Sure, I can look.")
    c.push(words(8))
    assert len(out) == 1
    c.push("Short but fine here.", paragraph_end=True)
    assert len(out) == 2
    assert out[1].paragraph_end is True
    assert out[1].text.endswith("Short but fine here.")


def test_a_one_to_three_word_paragraph_joins_the_previous_unsent_chunk():
    out, c = make()
    c.push("First sentence goes out.")
    c.push("Ten words go here in this chunk of text.")
    c.push("Done.", True)
    assert [k.text for k in out][1:] == ["Ten words go here in this chunk of text. Done."]


def test_a_lone_short_paragraph_is_said_alone_only_as_the_whole_reply():
    out, c = make()
    c.push("Done.", True)
    assert out == []
    c.end()
    assert [k.text for k in out] == ["Done."]


def test_a_lone_short_paragraph_waits_for_the_next_sentence():
    out, c = make()
    c.push("Done.", True)
    c.push("Now the next part follows.")
    assert [k.text for k in out] == ["Done. Now the next part follows."]


def test_a_huge_sentence_is_cut_at_a_comma_under_the_cap():
    out, c = make()
    c.push(", ".join(["alpha beta gamma delta"] * 30) + ".")  # 120 words, commas
    c.end()
    assert len(out) >= 3
    assert all(0 < count(k) <= MAX_WORDS for k in out)
    assert all(k.text.rstrip(".").endswith(("delta", "delta,")) for k in out)
    assert sum(count(k) for k in out) == 120


def test_a_huge_sentence_without_commas_is_cut_at_spaces():
    out, c = make()
    c.push(words(130))
    c.end()
    assert all(0 < count(k) <= MAX_WORDS for k in out)
    assert sum(count(k) for k in out) == 130


def test_end_flushes_and_is_idempotent():
    out, c = make()
    c.push("Sure, I can look.")
    c.push(words(5))
    assert len(out) == 1
    c.end()
    c.end()
    assert len(out) == 2
