"""The permission engine: one floor, swappable deciders, one decision path for every ask.

The floor (`Tier`, `ALLOWED`) is fixed in code: it says which deciders may speak for a tier, and
nothing the model or a preference says changes it. Call sites build an `AskRequest` and take the
`Decision`; the outcome mapping and the approvals-log write live here and nowhere else.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import timedelta
from enum import StrEnum
from typing import TYPE_CHECKING, Literal, Protocol

from brain.asks import AskExpired
from brain.protocol import ErrorCode, RpcError
from brain.side_check import AskFacts
from brain.store.rules import Preference

if TYPE_CHECKING:
    from brain.approvals import Approvals
    from brain.asks import Answer, Asks
    from brain.experts import PermissionOption
    from brain.mind.turn import Call
    from brain.offers import Offers
    from brain.side_check import SideCheck
    from brain.toolbox import ToolSpec

log = logging.getLogger(__name__)

SUMMARY_MAX = 200

# A Scout ask waits for the person: Scout may name how long, but never outside these bounds.
ASK_WAIT_ARG = "ask_wait_hours"
ASK_WAIT_DEFAULT = timedelta(days=3)
ASK_WAIT_MIN = timedelta(hours=1)
ASK_WAIT_MAX = timedelta(days=7)


def ask_wait(value: object) -> timedelta:
    """The model's hours, clamped; anything that is not a number is the default."""
    if isinstance(value, bool) or not isinstance(value, int | float) or value != value:
        return ASK_WAIT_DEFAULT
    # Compared as hours before converting, so an int too big for a float still clamps.
    if value >= ASK_WAIT_MAX / timedelta(hours=1):
        return ASK_WAIT_MAX
    if value <= ASK_WAIT_MIN / timedelta(hours=1):
        return ASK_WAIT_MIN
    return timedelta(hours=value)


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


def tier(spec: "ToolSpec") -> Tier:
    """A tool's own floor: what its source fixed, else its default mode, else its effect."""
    if spec.tier is not None:
        return spec.tier
    if spec.default_mode is not None:
        return Tier(spec.default_mode)
    return Tier.auto if spec.effect == "read" else Tier.ask


def gate_tier(spec: "ToolSpec", stored: str | None) -> Tier:
    """The tier one call is decided at, given the owner's stored choice for the tool."""
    if stored == "off":
        return Tier.off  # the owner's switch beats every floor
    if spec.tier is Tier.auto:
        return Tier.auto  # asks for itself
    own = tier(spec)
    if own is Tier.auto and stored == "ask":
        return Tier.ask
    return own


def resolve_mode(spec: "ToolSpec", stored: str | None) -> Literal["off", "ask", "auto"]:
    """The mode a tool runs in; Home's permission list reads this too, so both always agree."""
    gate = gate_tier(spec, stored)
    if gate is Tier.off:
        return "off"
    if gate is Tier.auto:
        return "auto"
    if gate is Tier.person_only:
        return "ask"  # a stored auto never opens it
    if stored in ("ask", "auto"):
        return stored  # for a locked tool too: the Home switch is its explicit unlock
    return "ask"


@dataclass(frozen=True)
class PersonAnswer:
    choice: Literal["allow", "always", "deny"]
    option_id: str | None = None


class NoOneThere(Exception):
    """Raised by an asker when a turn-bound card finds nobody displaying to ask."""


class AskOpen(Exception):
    """A Scout ask is open for the person; the call did not run and the turn goes on."""

    def __init__(self, ask_id: str) -> None:
        super().__init__(ask_id)
        self.ask_id = ask_id


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
    # The card never waits for Scout's side-check. A live ask (`how_to_ask`) is asked beside it;
    # an ask Scout parks has no waiter, so `show_card` puts its item on screen first. When the
    # side-check decides first, `settled("side_check")` closes that card (the open item's answer).
    show_card: Callable[[], None] | None = None
    settled: Callable[[str], None] | None = None


@dataclass(frozen=True)
class Grant:
    decided_by: Literal["rule", "scout", "person"]
    always: bool = False
    preference: Preference | None = None
    option_id: str | None = None


@dataclass(frozen=True)
class Refusal:
    code: Literal["denied", "expired", "cancelled", "no_one"]
    reason: str
    option_id: str | None = None


@dataclass(frozen=True)
class Decision:
    kind: Literal["allow_once", "allow_always", "deny", "parked"]
    code: str = ""  # deny: off, denied, expired, cancelled, no_one, no_decider
    decided_by: str = "none"
    option_id: str | None = None
    ask_id: str = ""
    reason: str = ""  # plain words, never tool text

    @property
    def allowed(self) -> bool:
        return self.kind in ("allow_once", "allow_always")


class Decider(Protocol):
    name: str

    async def decide(self, req: AskRequest) -> Grant | Refusal | None: ...


def summarise(text: str, tool: str, input: dict) -> str:
    line = text or f"{tool} {json.dumps(input, sort_keys=True, separators=(',', ':'))}"
    return line[:SUMMARY_MAX]


# --- deciders -----------------------------------------------------------------


@dataclass(frozen=True)
class Rule:
    """The shape of a `rules` row a standing rule reads. Only unscoped rules match for now and
    `expires_at` is not read yet; both are in the shape so scoped grants need no migration."""

    what: str
    scope: str | None
    effect: Literal["allow"]
    expires_at: str | None


class StandingRule:
    name = "standing_rule"

    def __init__(self, rules: Callable[[], list[Rule]]) -> None:
        self._rules = rules

    async def decide(self, req: AskRequest) -> Grant | None:
        if any(r.what == req.tool and r.scope is None for r in self._rules()):
            return Grant("rule")
        return None


def stored_auto_rules(modes: Callable[[], dict[str, str]]) -> Callable[[], list[Rule]]:
    """A tool the person set to Auto on Home is one unscoped allow rule."""
    return lambda: [Rule(tool, None, "allow", None) for tool, m in modes().items() if m == "auto"]


class SideCheckDecider:
    name = "side_check"

    def __init__(self, side_check: "SideCheck") -> None:
        self._side_check = side_check

    async def decide(self, req: AskRequest) -> Grant | None:
        facts = AskFacts(req.source, req.tool, req.summary, req.input, req.group_key)
        pref = await self._side_check.decide(facts)
        return Grant("scout", preference=pref) if pref is not None else None


class Person:
    name = "person"

    async def decide(self, req: AskRequest) -> Grant | Refusal | None:
        if req.how_to_ask is None:
            return None
        try:
            answer = await req.how_to_ask()
        except NoOneThere:
            return Refusal("no_one", "nobody online")
        except AskExpired as err:
            return Refusal("expired", err.reason)
        except RpcError as err:
            if err.code is ErrorCode.cancelled:
                return Refusal("cancelled", "the ask was cancelled")
            raise
        if answer.choice == "deny":
            return Refusal("denied", "the person said no", answer.option_id)
        return Grant("person", always=answer.choice == "always", option_id=answer.option_id)


# --- askers: the person's channel for each kind of ask ---------------------------


def tool_asker(
    asks: "Asks",
    call: "Call",
    tool: str,
    tier: Tier,
    ask_id: str,
    parent_id: str | None,
) -> Callable[[], Awaitable[PersonAnswer]]:
    async def ask() -> PersonAnswer:
        # Only a plain `ask` tier offers "always"; every stricter tier is asked every time.
        locked = tier is not Tier.ask
        choice = await asks.permission(call, tool, locked, ask_id=ask_id, parent_id=parent_id)
        return PersonAnswer(choice)  # type: ignore[arg-type]

    return ask


def expert_asker(
    open_ask: "Callable[..., Awaitable[Answer]]",
    tool: str,
    input: dict,
    options: "Sequence[PermissionOption]",
    ask_id: str,
) -> Callable[[], Awaitable[PersonAnswer]]:
    """The expert's own option names go on the card; the pick maps back to its option id here."""
    by_name = {o.name: o for o in options}

    async def ask() -> PersonAnswer:
        answer = await open_ask(
            ask_id=ask_id, text="", tool=tool, input=input, options=[o.name for o in options]
        )
        if answer.option is None:
            raise NoOneThere
        picked = by_name[answer.option]  # Asks.answer only takes an offered option
        return PersonAnswer("allow" if picked.kind.startswith("allow") else "deny", picked.id)

    return ask


# --- the engine ---------------------------------------------------------------

_GRANTED_BY = {"standing_rule": "rule", "side_check": "scout", "person": "person"}
_NEEDS_ALLOW_ONCE = frozenset({"standing_rule", "side_check"})  # an expert may offer no allow_once
_REFUSAL_ROW = {
    "denied": ("refused", "person"),
    "expired": ("expired", "none"),
    "no_one": ("no_one", "none"),
}


class Engine:
    """The one decision path: the floor, then the deciders in order, then one outcome mapping."""

    def __init__(
        self,
        deciders: Sequence[Decider],
        approvals: "Approvals | None",
        offers: "Offers | None",
        set_auto: Callable[[str], None],
    ) -> None:
        self._deciders = list(deciders)
        self._approvals = approvals  # None writes no rows
        self._offers = offers
        self._set_auto = set_auto

    async def decide(self, req: AskRequest) -> Decision:
        if req.tier is Tier.off:
            return Decision("deny", "off", ask_id=req.ask_id)
        if req.tier is Tier.auto:
            return Decision("allow_once", ask_id=req.ask_id)
        asked = False  # the person's channel already ran beside the side-check
        for decider in self._deciders:
            if decider.name not in ALLOWED[req.tier] or (asked and decider.name == "person"):
                continue
            if decider.name in _NEEDS_ALLOW_ONCE and not req.can_allow_once:
                continue
            try:
                if decider.name == "side_check":
                    person = self._person(req)
                    asked = person is not None and req.how_to_ask is not None
                    decider, result = await self._beside_card(decider, person, req)
                else:
                    result = await decider.decide(req)
            except Exception as err:  # fail closed: a broken decider is a pass
                log.warning("decider %s failed: %s", decider.name, type(err).__name__)
                continue
            if isinstance(result, Grant) and result.decided_by == _GRANTED_BY[decider.name]:
                try:
                    return self._granted(req, decider.name, result, asked)
                except Exception as err:
                    if decider.name != "side_check":
                        raise
                    # Scout's grant could not be counted or logged: leave it to the person.
                    log.warning("side_check grant failed: %s", type(err).__name__)
                    continue
            if isinstance(result, Refusal):
                return self._refused(req, result)
        return Decision("deny", "no_decider", ask_id=req.ask_id)

    def _person(self, req: AskRequest) -> Decider | None:
        allowed = ALLOWED[req.tier]
        return next((d for d in self._deciders if d.name == "person" and d.name in allowed), None)

    async def _beside_card(
        self, side: Decider, person: Decider | None, req: AskRequest
    ) -> tuple[Decider, Grant | Refusal | None]:
        """Run the side-check with the person's card already up. Whoever settles first decides:
        Scout's grant withdraws the card, the person's answer stops the look."""
        if req.show_card is not None:
            req.show_card()
        if person is None or req.how_to_ask is None:
            return side, await side.decide(req)
        look = asyncio.ensure_future(side.decide(req))
        card = asyncio.ensure_future(person.decide(req))
        try:
            await asyncio.wait({look, card}, return_when=asyncio.FIRST_COMPLETED)
            if look.done() and not card.done():
                granted = self._look_result(look)
                if granted is not None:
                    if req.settled is not None:
                        req.settled(
                            "side_check"
                        )  # before the card is withdrawn, so it reads as Scout's yes
                    return side, granted
                return person, await card  # a pass: only the person is left
            return person, card.result()  # the card was answered first
        finally:
            for task in (look, card):
                if not task.done():
                    task.cancel()
            await asyncio.gather(look, card, return_exceptions=True)

    @staticmethod
    def _look_result(look: "asyncio.Future") -> Grant | None:
        if look.cancelled() or look.exception() is not None:
            return None
        result = look.result()
        return result if isinstance(result, Grant) else None

    def _granted(
        self, req: AskRequest, decider: str, grant: Grant, raced: bool = False
    ) -> Decision:
        # "Always" widens only when the person asks for it, on a tier that can be widened.
        always = (
            grant.always
            and decider == "person"
            and req.tier in (Tier.ask, Tier.locked)
            and req.kind == "tool"
        )
        # Only Scout's own look approves under a preference; any other grant carries none.
        pref = grant.preference if decider == "side_check" else None
        self._record(req, "approved", grant.decided_by, pref)
        if decider == "side_check" and req.settled is not None and not raced:
            req.settled("side_check")
        if always:
            self._set_auto(req.tool)  # now Auto: an offer would be noise
        elif decider == "person" and req.offer and req.tier is not Tier.person_only:
            if self._offers is not None:
                self._offers.consider(req.group_key, req.source, req.tool)
        return Decision(
            "allow_always" if always else "allow_once",
            decided_by=grant.decided_by,
            option_id=grant.option_id,
            ask_id=req.ask_id,
        )

    def _refused(self, req: AskRequest, refusal: Refusal) -> Decision:
        # A cancelled ask is not a final outcome, so it writes no row.
        outcome, by = _REFUSAL_ROW.get(refusal.code, (None, "none"))
        if outcome is not None:
            self._record(req, outcome, by, reason=refusal.reason)
        return Decision("deny", refusal.code, by, refusal.option_id, req.ask_id, refusal.reason)

    def _record(
        self,
        req: AskRequest,
        outcome: str,
        decided_by: str,
        preference: Preference | None = None,
        reason: str | None = None,
    ) -> None:
        if self._approvals is None:
            return
        self._approvals.record(
            source=req.source,
            tool=req.tool,
            summary=req.summary,
            input=req.input,
            group_key=req.group_key,
            outcome=outcome,
            job_id=req.job_id,
            decided_by=decided_by,
            preference=preference,
            ask_id=req.ask_id,
            reason=reason,
        )
