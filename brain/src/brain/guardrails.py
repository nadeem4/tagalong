"""Guardrails on what the model loop may spend.

The daily budget is a small JSON ledger in the data folder so the limit survives restarts.
Unknown models are priced like Opus so a typo can never make spending look free.
"""

import datetime
import json
from collections.abc import Callable
from pathlib import Path

# USD per million tokens: input, output, cache write, cache read.
PRICES = {
    "claude-opus-5-5": (4.0, 20.0, 5.0, 0.20),
    "claude-sonnet-5-5": (2.0, 10.0, 2.5, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.125, 0.01),
}
FALLBACK_PRICES = PRICES["claude-opus-5-5"]
# USD per web search: 10 USD per 1,000 searches. Fetching a page has no fee of its own (its text
# is billed as input tokens). Counted from usage.server_tool_use.web_search_requests.
WEB_SEARCH_USD = 0.01


def _searches(usage) -> int:
    """Searches the server ran for this message; a missing or odd field counts as none."""
    server = getattr(usage, "server_tool_use", None)
    if isinstance(server, dict):
        count = server.get("web_search_requests")
    else:
        count = getattr(server, "web_search_requests", None)
    return count if isinstance(count, int) else 0


class Budget:
    def __init__(
        self,
        path: Path,
        limit_usd: float,
        today: Callable[[], datetime.date] = datetime.date.today,
    ):
        self._path = path
        self._limit = limit_usd
        self._today = today
        self._date = today().isoformat()
        self._spent = self._load()

    @property
    def spent(self) -> float:
        self._roll()
        return self._spent

    @property
    def limit(self) -> float:
        return self._limit

    @limit.setter
    def limit(self, usd: float) -> None:
        self._limit = usd

    def allows(self) -> bool:
        return self.spent < self._limit

    def spend(self, usage, model: str) -> None:
        self._roll()
        rates = PRICES.get(model, FALLBACK_PRICES)
        tokens = (
            getattr(usage, "input_tokens", None) or 0,
            getattr(usage, "output_tokens", None) or 0,
            getattr(usage, "cache_creation_input_tokens", None) or 0,
            getattr(usage, "cache_read_input_tokens", None) or 0,
        )
        self._spent += sum(t * r for t, r in zip(tokens, rates, strict=True)) / 1_000_000
        self._spent += _searches(usage) * WEB_SEARCH_USD
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps({"date": self._date, "spent_usd": self._spent}))

    def _roll(self) -> None:
        now = self._today().isoformat()
        if now != self._date:
            self._date, self._spent = now, 0.0

    def _load(self) -> float:
        try:
            data = json.loads(self._path.read_text())
            if data["date"] == self._date:
                return float(data["spent_usd"])
        except (OSError, ValueError, KeyError, TypeError):
            pass
        return 0.0
