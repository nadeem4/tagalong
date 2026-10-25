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
    model: str | None = None  # who answered; differs from the request after a fallback


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
        yield Final([b.to_dict() for b in msg.content], msg.stop_reason, msg.usage, msg.model)


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
    steps = 0
    spoke = False  # the contract wants exactly one reply.done iff any delta went out
    try:
        while True:
            if not budget.allows():
                reason = "over_budget"
                break
            if steps == step_cap:
                reason = "step_cap"
                break
            steps += 1

            stream = model.stream(system(), history, tools).__aiter__()
            final = None
            failed = False
            while True:
                try:
                    item = await anext(stream)
                except StopAsyncIteration:
                    break
                except Exception:
                    log.exception("model call failed")
                    failed = True
                    break
                if isinstance(item, Final):
                    final = item
                else:
                    spoke = True
                    notify("reply", {"turn": turn_id, "body": body_id, "delta": item})
            if failed or final is None:
                if not failed:
                    log.error("model stream ended without a final message")
                reason = "error"
                break

            history.append({"role": "assistant", "content": final.content})
            budget.spend(final.usage, final.model or model.model_id)
            if final.stop_reason == "pause_turn":
                continue

            calls = [b for b in final.content if b.get("type") == "tool_use"]
            if final.stop_reason == "tool_use" and calls:
                results = await _run_tools(turn_id, calls, run_tool, notify, running)
                history.append({"role": "user", "content": results + _drain(inbox)})
                continue
            closed = _close_dangling_tool_use(history)
            if final.stop_reason == "refusal":
                reason = "error"
                break
            says = _drain(inbox)
            if not says:
                reason = "done"
                break
            if closed:
                history[-1]["content"] += says
            else:
                history.append({"role": "user", "content": says})
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
        for call, name in running.items():
            notify(
                "tool",
                {"turn": turn_id, "call": call, "name": name, "state": "ended", "ok": False},
            )
        reason = "cancelled" if cancelled else "error"
    if spoke:
        notify("reply", {"turn": turn_id, "body": body_id, "done": True})
    return reason


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
        # A tool raising CancelledError leaves gather early; wait so no sibling outlives the turn.
        await asyncio.gather(*tasks, return_exceptions=True)


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
