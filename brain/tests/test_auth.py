"""Authenticator: a token becomes a principal, or nothing."""

from brain.auth import CLIENT_KINDS, Authenticator, Principal, listener_auth


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


def test_without_a_local_token_only_devices_get_in():
    dev = Principal(key="device:d1", name="Phone", kind="node", local=False, device_id="d1")

    class Fake:
        def verify(self, token):
            return dev if token == "dtok" else None

    a = Authenticator(None, Fake())
    assert a.identify("dtok") == dev
    assert a.identify("") is None and a.identify("abc") is None


def test_the_network_listener_takes_device_tokens_and_not_the_local_token():
    dev = Principal(key="device:d1", name="Phone", kind="node", local=False, device_id="d1")

    class Fake:
        def verify(self, token):
            return dev if token == "dtok" else None

    loopback, network = listener_auth("abc", Fake())
    assert loopback.identify("abc").local
    assert loopback.identify("dtok").device_id == "d1" and loopback.identify("dtok").local
    assert network.identify("abc") is None
    assert network.identify("dtok") == dev


def test_a_memory_client_token_is_refused_unless_the_caller_asks_for_clients():
    client = Principal(key="device:c1", name="cc", kind="mcp_client", local=False, device_id="c1")

    class Fake:
        def verify(self, token):
            return client

    a = Authenticator(None, Fake())
    assert a.identify("t") is None
    assert a.identify("t", CLIENT_KINDS) == client
