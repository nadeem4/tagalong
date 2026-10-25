"""The thinking loop: ask the model, stream its words, run its tools, repeat until it is done.

History is append-only and always valid: a half-streamed message is never stored and a
tool_use never goes unanswered, even when the turn is cancelled. The loop writes no words of
its own; it only reports why it stopped.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any, Protocol

log = logging.getLogger(__name__)


@dataclass
class Final:
    content: list[dict]
    stop_reason: str | None
    usage: Any


class Model(Protocol):
    model_id: str

    def stream(self, system: str, messages: list, tools: list) -> AsyncIterator[str | Final]:
        """Yield text deltas, then one Final."""
        ...


def _request(model_id: str, system: str, messages: list, tools: list) -> dict:
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
    def __init__(self, client, model_id: str):
        self._client = client
        self.model_id = model_id

    async def stream(self, system: str, messages: list, tools: list) -> AsyncIterator[str | Final]:
        kwargs = _request(self.model_id, system, messages, tools)
        async with self._client.beta.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text
            msg = await stream.get_final_message()
        yield Final([b.to_dict() for b in msg.content], msg.stop_reason, msg.usage)


async def run_turn(
    *,
    turn_id: str,
    body_id: str | None,
    model: Model,
    system: Callable[[], str],
    history: list,
    tools: list,
    run_tool: Callable[[str, dict], Any],
    inbox: list,
    notify: Callable[[str, dict], None],
    budget,
    step_cap: int,
) -> str:
    running: dict[str, str] = {}  # call id -> tool name, for tools that have not finished
    try:
        return await _loop(
            turn_id, body_id, model, system, history, tools, run_tool, inbox, notify, budget,
            step_cap, running,
        )  # fmt: skip
    except asyncio.CancelledError:
        _close_dangling_tool_use(history)
        for call, name in running.items():
            notify(
                "tool", {"turn": turn_id, "call": call, "name": name, "state": "ended", "ok": False}
            )
        return "cancelled"


async def _loop(
    turn_id, body_id, model, system, history, tools, run_tool, inbox, notify, budget,
    step_cap, running,
) -> str:  # fmt: skip
    steps = 0
    while True:
        if not budget.allows():
            return "over_budget"
        if steps == step_cap:
            return "step_cap"
        steps += 1

        final = None
        try:
            async for item in model.stream(system(), history, tools):
                if isinstance(item, Final):
                    final = item
                else:
                    notify("reply", {"turn": turn_id, "body": body_id, "delta": item})
            if final is None:
                raise RuntimeError("model stream ended without a final message")
        except Exception:
            log.exception("model call failed")
            return "error"

        history.append({"role": "assistant", "content": final.content})
        budget.spend(final.usage, model.model_id)
        if final.stop_reason == "refusal":
            return "error"
        if final.stop_reason == "pause_turn":
            continue

        calls = [b for b in final.content if b.get("type") == "tool_use"]
        if final.stop_reason == "tool_use" and calls:
            results = await _run_tools(turn_id, calls, run_tool, notify, running)
            history.append({"role": "user", "content": results + _drain(inbox)})
        elif says := _drain(inbox):
            history.append({"role": "user", "content": says})
        else:
            notify("reply", {"turn": turn_id, "body": body_id, "done": True})
            return "done"


def _drain(inbox: list) -> list[dict]:
    blocks = [block for say in inbox for block in say]
    inbox.clear()
    return blocks


async def _run_tools(turn_id, calls, run_tool, notify, running) -> list[dict]:
    async def one(call: dict) -> dict:
        info = {"turn": turn_id, "call": call["id"], "name": call["name"]}
        running[call["id"]] = call["name"]
        notify("tool", {**info, "state": "started"})
        try:
            content = await run_tool(call["name"], call["input"])
            result = {"type": "tool_result", "tool_use_id": call["id"], "content": content}
        except Exception as err:
            text = str(err) or type(err).__name__
            result = {
                "type": "tool_result",
                "tool_use_id": call["id"],
                "content": [{"type": "text", "text": text}],
                "is_error": True,
            }
        del running[call["id"]]
        notify("tool", {**info, "state": "ended", "ok": "is_error" not in result})
        return result

    tasks = [asyncio.ensure_future(one(c)) for c in calls]
    try:
        return list(await asyncio.gather(*tasks))
    finally:
        for task in tasks:
            task.cancel()  # no-op for finished tasks; stops stragglers when the turn is cancelled


def _close_dangling_tool_use(history: list) -> None:
    last = history[-1] if history else None
    if not last or last["role"] != "assistant" or not isinstance(last["content"], list):
        return
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
