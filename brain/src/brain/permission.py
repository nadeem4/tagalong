"""The permission engine: one floor, swappable deciders, one decision path for every ask.

The floor (`Tier`, `ALLOWED`) is fixed in code: it says which deciders may speak for a tier, and
nothing the model or a preference says changes it. Call sites build an `AskRequest` and take the
`Decision`; the outcome mapping and the approvals-log write live here and nowhere else.
"""

import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal, Protocol

from brain.store.rules import Preference

SUMMARY_MAX = 200


class Tier(StrEnum):
    off = "off"  # nobody may decide: refused
    person_only = "person_only"  # the person, every time
    locked = "locked"  # the person, or a stored Auto set on Home
    ask = "ask"  # any decider
    auto = "auto"  # nobody is asked: allowed


# Which deciders may speak for each tier. A change here is a change to the floor.
ALLOWED: dict[Tier, frozenset[str]] = {
    Tier.off: frozenset(),
    Tier.person_only: frozenset({"person"}),
    Tier.locked: frozenset({"standing_rule", "person"}),
    Tier.ask: frozenset({"standing_rule", "side_check", "person"}),
    Tier.auto: frozenset(),
}


@dataclass(frozen=True)
class PersonAnswer:
    choice: Literal["allow", "always", "deny"]
    option_id: str | None = None


class NoOneThere(Exception):
    """Raised by an asker when nobody displaying can be asked."""


@dataclass(frozen=True)
class AskRequest:
    kind: Literal["tool", "expert_request", "hand_off_followup"]
    source: str
    tool: str
    group_key: str
    summary: str
    input: dict
    tier: Tier
    how_to_ask: Callable[[], Awaitable[PersonAnswer]] | None
    job_id: str | None = None
    turn_id: str | None = None
    ask_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    can_allow_once: bool = True
    offer: bool = True


@dataclass(frozen=True)
class Grant:
    decided_by: Literal["rule", "scout", "person"]
    always: bool = False
    preference: Preference | None = None
    option_id: str | None = None


@dataclass(frozen=True)
class Refusal:
    code: Literal["denied", "timeout", "cancelled", "no_one"]
    reason: str
    option_id: str | None = None


@dataclass(frozen=True)
class Decision:
    kind: Literal["allow_once", "allow_always", "deny", "parked"]
    code: str = ""  # deny: off, denied, timeout, cancelled, no_one, no_decider
    decided_by: str = "none"
    option_id: str | None = None
    ask_id: str = ""

    @property
    def allowed(self) -> bool:
        return self.kind in ("allow_once", "allow_always")


class Decider(Protocol):
    name: str

    async def decide(self, req: AskRequest) -> Grant | Refusal | None: ...


def summarise(text: str, tool: str, input: dict) -> str:
    line = text or f"{tool} {json.dumps(input, sort_keys=True, separators=(',', ':'))}"
    return line[:SUMMARY_MAX]
