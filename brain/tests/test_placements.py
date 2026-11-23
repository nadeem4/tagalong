"""Where an app or expert runs: the five modes, and the placements table."""

import pytest

from brain.placements import Choose, Placement, Placements, Unavailable, resolve_placement
from brain.store.db import open_db


def online(*ids):
    return lambda body_id: body_id in ids


# (placement, node online, brain can run it) -> where, or the error raised
CASES = [
    (Placement("brain"), True, True, "brain"),
    (Placement("body", "pc"), True, True, "pc"),
    (Placement("body", "pc"), False, True, Unavailable),
    (Placement("both", "pc", "body"), True, True, "pc"),
    (Placement("both", "pc", "body"), False, True, "brain"),
    (Placement("both", "pc", "body"), False, False, Unavailable),
    (Placement("both", "pc", "brain"), True, True, "brain"),
    (Placement("both", "pc", "brain"), True, False, "pc"),
    (Placement("both", "pc", "brain"), False, False, Unavailable),
    (Placement("both", "pc", "ask"), True, True, Choose),
    (Placement("both", "pc", "ask"), False, True, "brain"),
    (Placement("both", "pc", "ask"), True, False, "pc"),
    (None, False, True, "brain"),
]


@pytest.mark.parametrize(("placement", "node_up", "brain_ok", "expected"), CASES)
def test_the_five_modes(placement, node_up, brain_ok, expected):
    nodes = online("pc") if node_up else online()
    if isinstance(expected, str):
        assert resolve_placement(placement, nodes, brain_ok) == expected
    else:
        with pytest.raises(expected):
            resolve_placement(placement, nodes, brain_ok)


def test_unavailable_names_the_body():
    with pytest.raises(Unavailable) as err:
        resolve_placement(Placement("body", "pc"), online(), True)
    assert err.value.body_id == "pc"


def test_a_placement_persists_and_is_replaced(tmp_path):
    db = open_db(tmp_path / "p.db")
    store = Placements(db)
    assert store.get("app", "gh") is None
    store.set("app", "gh", Placement("both", "pc", "ask"))
    store.set("app", "gh", Placement("body", "pc"))
    assert store.get("app", "gh") == Placement("body", "pc")
    assert Placements(db).get("expert", "gh") is None


def test_a_body_mode_needs_a_body():
    with pytest.raises(ValueError):
        Placement("body")
    with pytest.raises(ValueError):
        Placement("both", "pc")
