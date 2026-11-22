"""One-time pairing codes: single use, ten-minute life, rate limited, bound to a kind."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest

from brain.devices import Devices
from brain.identity import load_or_create_identity
from brain.pairing import Pairing
from brain.store.db import open_db, utc_text


class Clock:
    def __init__(self):
        self.t = datetime(2026, 11, 21, tzinfo=UTC)

    def __call__(self):
        return utc_text(self.t)

    def advance(self, **kw):
        self.t += timedelta(**kw)


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def identity(tmp_path):
    return load_or_create_identity(tmp_path)


def build(db, identity, clock):
    return Pairing(db, Devices(db, clock), identity, clock, lambda: "192.168.1.5:47322")


@pytest.fixture
def pairing(tmp_path, identity, clock):
    return build(open_db(tmp_path / "t.db"), identity, clock)


def test_link_holds_addr_fingerprint_and_code(pairing, identity):
    offer = pairing.make_code()
    q = parse_qs(urlparse(offer.link).query)
    assert offer.link.startswith("tagalong://pair?")
    assert q["addr"] == ["192.168.1.5:47322"]
    assert q["fp"] == [identity.fingerprint] and q["code"] == [offer.secret]


def test_code_works_once_and_gives_a_working_token(pairing):
    offer = pairing.make_code()
    result = pairing.redeem(offer.secret, "Laptop", "desktop", loopback=False)
    assert result is not None
    assert pairing._devices.verify(result[1]) is not None
    assert pairing.redeem(offer.secret, "Laptop", "desktop", loopback=False) is None


def test_two_connections_redeeming_at_once_only_one_wins(tmp_path, identity, clock):
    path = tmp_path / "t.db"
    offer = build(open_db(path), identity, clock).make_code()

    def redeem(_):
        return build(open_db(path), identity, clock).redeem(
            offer.secret, "A", "desktop", loopback=False
        )

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(redeem, range(2)))
    assert sum(r is not None for r in results) == 1


def test_expires_after_ten_minutes(pairing, clock):
    offer = pairing.make_code()
    clock.advance(minutes=10, seconds=1)
    assert pairing.redeem(offer.secret, "A", "desktop", loopback=False) is None


def test_rate_limit_blocks_even_a_right_code_until_the_minute_passes(pairing, clock):
    offer = pairing.make_code()
    for _ in range(5):
        assert pairing.redeem("wrong", "A", "desktop", loopback=False) is None
    assert pairing.redeem(offer.secret, "A", "desktop", loopback=False) is None
    clock.advance(seconds=61)
    assert pairing.redeem(offer.secret, "A", "desktop", loopback=False) is not None


def test_browser_code_is_loopback_only_and_short(pairing):
    offer = pairing.make_code("browser")
    assert len(offer.secret) == 6 and offer.secret.isdigit()
    assert pairing.redeem(offer.secret, "Chrome", "browser", loopback=False) is None
    assert pairing.redeem(offer.secret, "Chrome", "browser", loopback=True) is not None


def test_loopback_accepts_only_browser_codes(pairing):
    offer = pairing.make_code("desktop")
    assert pairing.redeem(offer.secret, "PC", "desktop", loopback=True) is None


def test_a_desktop_code_cannot_make_a_node_device(pairing):
    offer = pairing.make_code("desktop")
    assert pairing.redeem(offer.secret, "x", "node", loopback=False) is None
