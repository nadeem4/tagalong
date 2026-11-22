"""The local token: made once per home, reused, different per home."""

from brain.local_token import load_or_create_local_token


def test_created_once_and_reused(tmp_path):
    a = load_or_create_local_token(tmp_path)
    b = load_or_create_local_token(tmp_path)
    assert a == b and len(a) == 43
    assert (tmp_path / "local-token").read_text().strip() == a


def test_two_homes_get_different_tokens(tmp_path):
    one, two = tmp_path / "a", tmp_path / "b"
    one.mkdir()
    two.mkdir()
    assert load_or_create_local_token(one) != load_or_create_local_token(two)
