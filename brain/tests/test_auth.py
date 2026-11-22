"""Authenticator: a token becomes a principal, or nothing."""

from brain.auth import Authenticator, Principal


def test_local_token_gives_the_local_principal():
    p = Authenticator("abc").identify("abc")
    assert p == Principal(key="local", name="this computer", kind="local", local=True)


def test_wrong_empty_or_longer_token_is_refused():
    a = Authenticator("abc")
    assert a.identify("abd") is None
    assert a.identify("") is None
    assert a.identify("abcd") is None


def test_device_check_is_asked_when_local_does_not_match():
    dev = Principal(key="device:d1", name="Phone", kind="desktop", local=False, device_id="d1")

    class Fake:
        def verify(self, token):
            return dev if token == "dtok" else None

    a = Authenticator("abc", Fake())
    assert a.identify("dtok") == dev
    assert a.identify("nope") is None
