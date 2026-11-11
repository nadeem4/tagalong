"""Checks the model choice: the three models, the saved override of the env default.

No network and no model: only the settings table and the price list.
"""

import pytest

from brain import models
from brain.guardrails import PRICES
from brain.store.db import open_db
from brain.store.settings import set_setting


@pytest.fixture
def db(tmp_path):
    db = open_db(tmp_path / "t.db")
    yield db
    db.close()


def test_chosen_defaults_to_env(db):
    assert models.chosen(db, "claude-sonnet-5-5") == "claude-sonnet-5-5"


def test_saved_choice_overrides_env(db):
    models.save(db, "claude-haiku-5-5")
    assert models.chosen(db, "claude-sonnet-5-5") == "claude-haiku-5-5"


def test_unknown_saved_model_falls_back(db):
    set_setting(db, "model", "gpt-9")
    assert models.chosen(db, "claude-sonnet-5-5") == "claude-sonnet-5-5"


def test_every_model_has_a_price():
    assert [m.id for m in models.MODELS] == [
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
    ]
    assert all(m.id in PRICES for m in models.MODELS)
    assert models.DEFAULT_MODEL_ID == "claude-opus-5-5"
