"""The thinking loop: ask the model, stream its words, run its tools, repeat until it is done.

History is append-only and always valid: a half-streamed message is never stored and a
tool_use never goes unanswered, even when the turn is cancelled. A cancelled step keeps the
words the person already saw as its reply, so the cut-off request counts as answered and the
next turn does not resume it. The loop writes no words of its own; it only reports why it stopped
(a timeout ends the turn with `error`; the body says so).

A pause (`stop`) is not a cancel: generation ends at once, but tools already running are handed
to `on_detached` and finish on their own, so the person talking over Scout destroys no work.
"""

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Protocol

from brain.builtin_guards import spend_guards
from brain.guards import Guards, Hook, ModelCallCtx
from brain.telemetry import TIMINGS, timed

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Call:
    id: str
    name: str
    input: dict
    turn: str
    text: str  # the step's own words before the call, for tools that ask the user


@dataclass
class Final:
    content: list[dict]
    stop_reason: str | None
    usage: Any
    model: str | None = None  # who answered; differs from the request after a fallback


class Model(Protocol):
    model_id: str
    ready: bool  # False until a key is set; the session does not call a model that is not ready

    def stream(
        self, system: str, messages: list, tools: list, max_tokens: int | None = None
    ) -> AsyncIterator[str | Final]:
        """Yield text deltas, then one Final. A `max_tokens` marks a short side call: a small
        cap, no thinking and no compaction (a turn leaves it out and gets the full allowance)."""
        ...


def _request(
    model_id: str, system: str, messages: list, tools: list, max_tokens: int | None = None
) -> dict:
    if max_tokens is not None:
        return {
            "model": model_id,
            "system": system,
            "messages": messages,
            "max_tokens": max_tokens,
            "output_config": {"effort": "low"},
            "tools": tools,
        }
    kwargs: dict = {
        "model": model_id,
        "system": system,
        "messages": messages,
        "max_tokens": 64000,
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "medium"},
        "betas": ["compact-2026-01-12", "server-side-fallback-2026-07-01"],
        "context_management": {"edits": [{"type": "compact_20260112"}]},
        "fallbacks": "default",
    }
    if tools:
        kwargs["tools"] = tools
    return kwargs


class AnthropicModel:
    """The client is built from the key on demand, so a key set from the app works at once and
    the brain can start with none."""

    def __init__(
        self,
        make_client: Callable[[str], Any],
        model_id: str | Callable[[], str],
        key: str | None = None,
    ):
        self._make_client = make_client
        self._client = make_client(key) if key else None
        self._choose = model_id if callable(model_id) else lambda: model_id
        self._pinned: str | None = None

    @property
    def model_id(self) -> str:
        return self._pinned or self._choose()

    def begin_turn(self) -> None:
        """Keep the model chosen now for every request of this turn: a change in Settings
        applies from the next turn, never halfway through a running one."""
        self._pinned = self._choose()

    def end_turn(self) -> None:
        """Let go of the pin: until the next turn the model is read live."""
        self._pinned = None

    @property
    def ready(self) -> bool:
        return self._client is not None

    def set_key(self, key: str) -> None:
        self._client = self._make_client(key)

    async def stream(
        self, system: str, messages: list, tools: list, max_tokens: int | None = None
    ) -> AsyncIterator[str | Final]:
        if self._client is None:
            raise RuntimeError("no Anthropic key yet")
        kwargs = _request(self.model_id, system, messages, tools, max_tokens)
        async with self._client.beta.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text
            msg = await stream.get_final_message()
        yield Final([b.to_dict() for b in msg.content], msg.stop_reason, msg.usage, msg.model)


def _blames_newest(err: Exception, history: list) -> bool:
    """True for a 400 that the newest request caused: it holds an image or document, or the
    error names one. A 400 about money, length or older history would hit any request, and
    dropping it would only cut the person's messages one after another."""
    last = history[-1] if history else None
    if getattr(err, "status_code", None) != 400 or last is None or last["role"] != "user":
        return False
    content = last["content"]
    if not isinstance(content, list) or any(b.get("type") == "tool_result" for b in content):
        return False  # after a tool round the newest message is the tools' answer, not theirs
    if any(b.get("type") in ("image", "document") for b in content):
        return True
    return any(word in str(err).lower() for word in ("image", "document"))


async def run_turn(**kwargs) -> str:
    async with timed("turn"):  # the whole turn, tools and waits included
        return await _run_turn(**kwargs)


async def _run_turn(
    *,
    turn_id: str,
    body_id: str | None,
    model: Model,
    system: Callable[[], str],
    history: list,
    tools: Callable[[], list[dict]],
    run_tool: Callable[[Call], Awaitable[str | list[dict]]],
    inbox: list,
    notify: Callable[[str, dict], None],
    budget,
    step_cap: int,
    guards: Guards | None = None,
    turn_timeout: float | None = None,
    on_owner_input: Callable[[], None] | None = None,
    on_last_read: Callable[[], None] | None = None,
    on_rejected: Callable[[], None] | None = None,
    stop: asyncio.Event | None = None,
    on_detached: Callable[[dict, asyncio.Future], None] | None = None,
) -> str:
    guards = guards or spend_guards(budget, step_cap)
    if begin := getattr(model, "begin_turn", None):
        begin()
    running: dict[str, str] = {}  # call id -> tool name, for tools that have not finished
    steps = 0
    shown: list[str] = []  # deltas of the step being streamed, kept if a cancel cuts it off
    spoke = False  # the contract wants exactly one reply.done iff any delta went out
    tail = ""  # the last words sent, so a new step's text can be set apart from them
    paused = False  # `stop` was set while the model was talking: end now, keeping what was shown
    try:
        try:
            async with asyncio.timeout(turn_timeout) as limit:
                while True:
                    if stop is not None and stop.is_set():
                        reason = "cancelled"
                        break
                    verdict = await guards.run(
                        Hook.model_call, ModelCallCtx("turn", turn_id, steps)
                    )
                    if verdict.kind in ("stop", "block"):
                        reason = verdict.code or "error"
                        break
                    steps += 1

                    stream = model.stream(system(), history, tools()).__aiter__()
                    model_clock = time.perf_counter()
                    final = None
                    failed = False
                    shown.clear()
                    while True:
                        try:
                            item = await _next(stream, stop)
                        except _Paused:
                            paused = True
                            break
                        except StopAsyncIteration:
                            break
                        except Exception as err:
                            log.exception("model call failed")
                            failed = True
                            # A 400 on the person's newest message (a bad image, say) would fail
                            # every later turn too; the session drops that message.
                            if on_rejected and _blames_newest(err, history):
                                on_rejected()
                            break
                        if isinstance(item, Final):
                            final = item
                            TIMINGS.record(
                                "model_call", time.perf_counter() - model_clock, {"step": steps}
                            )
                        else:
                            if not shown and tail and not tail[-1].isspace():
                                # A new step after a tool round: without a break its words run
                                # on from the lead-in ("...approve them.1) Moved...").
                                notify("reply", {"turn": turn_id, "body": body_id, "delta": "\n\n"})
                            spoke = True
                            tail = item or tail
                            shown.append(item)
                            notify("reply", {"turn": turn_id, "body": body_id, "delta": item})
                    if paused:
                        reason = "cancelled"
                        _keep_shown(history, shown)
                        break
                    if failed or final is None:
                        if not failed:
                            log.error("model stream ended without a final message")
                        reason = "error"
                        break

                    history.append({"role": "assistant", "content": final.content})
                    shown.clear()  # now in history; only a cut-off step is kept
                    budget.spend(final.usage, final.model or model.model_id)
                    if final.stop_reason == "pause_turn":
                        continue

                    calls = [b for b in final.content if b.get("type") == "tool_use"]
                    text = "".join(
                        b.get("text", "") for b in final.content if b.get("type") == "text"
                    )
                    if final.stop_reason == "tool_use" and calls:
                        clock = asyncio.get_running_loop().time
                        began, due = clock(), limit.when()
                        limit.reschedule(None)  # a person's slow ask never eats the clock
                        results = await _run_tools(
                            turn_id, calls, text, run_tool, notify, running, stop, on_detached
                        )
                        if due is not None:
                            limit.reschedule(due + clock() - began)
                        history.append(
                            {"role": "user", "content": results + _drain(inbox, on_owner_input)}
                        )
                        continue
                    closed = _close_dangling_tool_use(history)
                    if final.stop_reason == "refusal":
                        reason = "error"
                        break
                    says = _drain(inbox, on_owner_input)
                    if not says:
                        if on_last_read is not None:
                            on_last_read()  # nothing said from here on can reach this turn
                        reason = "done"
                        break
                    if closed:
                        history[-1]["content"] += says
                    else:
                        history.append({"role": "user", "content": says})
        except TimeoutError:
            if not limit.expired():
                raise  # a TimeoutError from inside the loop, not our clock
            log.warning("turn %s ran past %s s", turn_id, turn_timeout)
            _close_dangling_tool_use(history)
            reason = "error"
    except BaseException as err:
        cancelled = isinstance(err, asyncio.CancelledError)
        if cancelled:
            # Swallowed so the caller gets a reason; uncancel keeps an outer timeout's count right.
            task = asyncio.current_task()
            if task:
                task.uncancel()
        elif not isinstance(err, Exception):
            raise
        else:
            log.exception("turn failed")
        _close_dangling_tool_use(history)
        if cancelled:
            _keep_shown(history, shown)
        for call, name in running.items():
            notify(
                "tool",
                {"turn": turn_id, "call": call, "name": name, "state": "ended", "ok": False},
            )
        reason = "cancelled" if cancelled else "error"
    finally:
        if end := getattr(model, "end_turn", None):
            end()  # between turns the model is read live again (side checks, offers)
    _drop_unanswered_server_tool_use(history)
    if spoke:
        notify("reply", {"turn": turn_id, "body": body_id, "done": True})
    return reason


class _Paused(Exception):
    """The stop was set while waiting for the model's next words."""


async def _next(stream, stop: asyncio.Event | None):
    """The stream's next item, or `_Paused` the moment `stop` is set (the stream is closed)."""
    if stop is None:
        return await anext(stream)
    pending = asyncio.ensure_future(anext(stream))
    waiter = asyncio.ensure_future(stop.wait())
    try:
        await asyncio.wait({pending, waiter}, return_when=asyncio.FIRST_COMPLETED)
    except BaseException:
        # A real cancel (Stop, close, timeout, disconnect) must not leave the read running or
        # the provider's stream open: it would keep streaming, and billing.
        pending.cancel()
        await asyncio.gather(pending, return_exceptions=True)
        await stream.aclose()
        raise
    finally:
        waiter.cancel()
    if pending.done():
        return pending.result()  # a word that arrived with the stop is still shown
    pending.cancel()
    await asyncio.gather(pending, return_exceptions=True)
    await stream.aclose()
    raise _Paused


def _keep_shown(history: list, shown: list[str]) -> None:
    """The words the person already saw of a cut-off step are its reply, so the request counts as
    answered and the next turn does not resume it."""
    seen = "".join(shown)
    if seen.strip() and history and history[-1]["role"] == "user":
        history.append({"role": "assistant", "content": [{"type": "text", "text": seen}]})


def _drain(inbox: list, on_owner_input: Callable[[], None] | None = None) -> list[dict]:
    """Move the owner's says into history; `on_owner_input` fires only when there were some."""
    blocks = [block for say in inbox for block in say]
    inbox.clear()
    if blocks and on_owner_input is not None:
        on_owner_input()
    return blocks


async def _run_tools(
    turn_id, calls, said, run_tool, notify, running, stop=None, on_detached=None
) -> list[dict]:
    async def one(call: dict) -> dict:
        info = {"turn": turn_id, "call": call["id"], "name": call["name"]}
        running[call["id"]] = call["name"]
        notify("tool", {**info, "state": "started"})
        try:
            content = await run_tool(Call(call["id"], call["name"], call["input"], turn_id, said))
            result = {"type": "tool_result", "tool_use_id": call["id"], "content": content}
        except Exception as err:
            text = str(err) or type(err).__name__
            result = {
                "type": "tool_result",
                "tool_use_id": call["id"],
                "content": [{"type": "text", "text": text}],
                "is_error": True,
            }
        running.pop(call["id"], None)
        notify("tool", {**info, "state": "ended", "ok": "is_error" not in result})
        return result

    if stop is not None and stop.is_set():
        # The person already talked over Scout: nothing new starts.
        return [
            {
                "type": "tool_result",
                "tool_use_id": c["id"],
                "content": "not run: the person talked over Scout",
            }
            for c in calls
        ]
    tasks = [asyncio.ensure_future(one(c)) for c in calls]
    detached: set[asyncio.Future] = set()
    try:
        gathered = asyncio.gather(*tasks)
        if stop is None:
            return list(await gathered)
        waiter = asyncio.ensure_future(stop.wait())
        try:
            await asyncio.wait({gathered, waiter}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            waiter.cancel()
        if gathered.done():
            return list(gathered.result())
        # Paused: what finished is answered, what still runs goes on in the background and its
        # result comes back later; history answers its call so it stays valid.
        results = []
        for call, task in zip(calls, tasks, strict=True):
            if task.done():
                results.append(task.result())
                continue
            detached.add(task)
            running.pop(call["id"], None)
            if on_detached is not None:
                on_detached(call, task)
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": call["id"],
                    "content": "still running when the turn stopped",
                }
            )
        return results
    finally:
        left = [t for t in tasks if t not in detached]
        for task in left:
            task.cancel()  # no-op for finished tasks; stops stragglers when the turn is cancelled
        # A tool raising CancelledError leaves gather early; wait so no sibling outlives the turn.
        await asyncio.gather(*left, return_exceptions=True)


def _drop_unanswered_server_tool_use(history: list) -> None:
    """A paused message can end on a server_tool_use whose result never came; the turn stopped
    before the continuation, so drop it (and the message if nothing valid is left)."""
    last = history[-1] if history else None
    if not last or last["role"] != "assistant" or not isinstance(last["content"], list):
        return
    answered = {b.get("tool_use_id") for b in last["content"] if b.get("tool_use_id")}
    kept = [
        b for b in last["content"] if b.get("type") != "server_tool_use" or b.get("id") in answered
    ]
    if len(kept) == len(last["content"]):
        return
    if kept:
        last["content"] = kept
    else:
        history.pop()


def _close_dangling_tool_use(history: list) -> bool:
    """Answer unanswered tool_use blocks in the last message; True if it appended anything."""
    last = history[-1] if history else None
    if not last or last["role"] != "assistant" or not isinstance(last["content"], list):
        return False
    calls = [b for b in last["content"] if b.get("type") == "tool_use"]
    if calls:
        history.append(
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": c["id"],
                        "content": "cancelled",
                        "is_error": True,
                    }
                    for c in calls
                ],
            }
        )
    return bool(calls)
