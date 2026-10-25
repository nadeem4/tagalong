"""Checks the daily spend ledger: pricing, day rollover, persistence and corrupt files.

The budget is the brain's cost guardrail, so it must never undercount (unknown models use
the dearest prices) and must survive restarts.
"""

import datetime
import json
from types import SimpleNamespace

from brain.guardrails import Budget

DAY = datetime.date(2026, 10, 25)


def usage(i=0, o=0, cw=0, cr=0):
    return SimpleNamespace(
        input_tokens=i,
        output_tokens=o,
        cache_creation_input_tokens=cw,
        cache_read_input_tokens=cr,
    )


def make(tmp_path, limit=5.0, day=DAY):
    return Budget(tmp_path / "budget.json", limit, today=lambda: day)


def spent(tmp_path):
    return json.loads((tmp_path / "budget.json").read_text())["spent_usd"]


def test_opus_prices(tmp_path):
    b = make(tmp_path)
    b.spend(usage(1_000_000, 1_000_000, 1_000_000, 1_000_000), "claude-opus-5-5")
    assert abs(spent(tmp_path) - (4 + 20 + 5 + 0.20)) < 1e-9


def test_sonnet_and_haiku_prices(tmp_path):
    b = make(tmp_path)
    b.spend(usage(1_000_000, 1_000_000, 1_000_000, 1_000_000), "claude-sonnet-5-5")
    b.spend(usage(1_000_000, 1_000_000, 1_000_000, 1_000_000), "claude-haiku-5-5")
    assert abs(spent(tmp_path) - ((2 + 10 + 2.5 + 0.20) + (0.10 + 0.50 + 0.125 + 0.01))) < 1e-9


def test_unknown_model_uses_opus_prices(tmp_path):
    make(tmp_path).spend(usage(1_000_000), "mystery")
    assert abs(spent(tmp_path) - 4) < 1e-9


def test_none_tokens_count_as_zero(tmp_path):
    make(tmp_path).spend(
        SimpleNamespace(
            input_tokens=None,
            output_tokens=1_000_000,
            cache_creation_input_tokens=None,
            cache_read_input_tokens=None,
        ),
        "claude-opus-5-5",
    )
    assert abs(spent(tmp_path) - 20) < 1e-9


def test_allows_until_limit(tmp_path):
    b = make(tmp_path, limit=1.0)
    assert b.allows()
    b.spend(usage(0, 50_000), "claude-opus-5-5")  # exactly $1.00
    assert not b.allows()


def test_ledger_persists_across_instances(tmp_path):
    make(tmp_path).spend(usage(1_000_000), "claude-opus-5-5")
    assert abs(make(tmp_path).spent - 4) < 1e-9


def test_new_day_resets(tmp_path):
    make(tmp_path).spend(usage(1_000_000), "claude-opus-5-5")
    b = make(tmp_path, day=DAY + datetime.timedelta(days=1))
    assert b.allows() and b.spent == 0


def test_rollover_while_running(tmp_path):
    days = [DAY]
    b = Budget(tmp_path / "budget.json", 1.0, today=lambda: days[0])
    b.spend(usage(0, 50_000), "claude-opus-5-5")
    assert not b.allows()
    days[0] = DAY + datetime.timedelta(days=1)
    assert b.allows()


def test_corrupt_or_missing_file_starts_at_zero(tmp_path):
    assert make(tmp_path).spent == 0
    (tmp_path / "budget.json").write_text("{not json")
    assert make(tmp_path).spent == 0
    (tmp_path / "budget.json").write_text('{"date": "bad", "spent_usd": "x"}')
    assert make(tmp_path).spent == 0


def test_creates_parent_folder(tmp_path):
    b = Budget(tmp_path / "sub" / "budget.json", 5.0, today=lambda: DAY)
    b.spend(usage(1), "claude-opus-5-5")
    assert (tmp_path / "sub" / "budget.json").exists()


def test_ledger_format(tmp_path):
    make(tmp_path).spend(usage(1_000_000), "claude-opus-5-5")
    data = json.loads((tmp_path / "budget.json").read_text())
    assert data == {"date": "2026-10-25", "spent_usd": 4.0}
