"""Retry rules: which errors are transient, which tools are safe to run again.
Fakes only; the runner and resolve_step tests join this file in the next task.
"""

import anthropic
import httpx2 as httpx
import pytest

from brain.protocol import ErrorCode, RpcError
from brain.retry import classify, safe_to_retry
from brain.toolbox import ToolSpec

_REQUEST = httpx.Request("POST", "https://example.invalid")


def _rate_limit() -> BaseException:
    return anthropic.RateLimitError(
        "slow down", response=httpx.Response(429, request=_REQUEST), body=None
    )


@pytest.mark.parametrize(
    "err",
    [
        TimeoutError(),
        ConnectionError("reset"),
        _rate_limit(),
        anthropic.APIConnectionError(request=_REQUEST),
        anthropic.APITimeoutError(request=_REQUEST),
        RpcError(ErrorCode.timeout, "no answer"),
    ],
)
def test_classify_known_transients(err):
    assert classify(err) == "transient"


@pytest.mark.parametrize(
    "err", [ValueError("bad"), KeyError("x"), RpcError(ErrorCode.denied, "no"), RuntimeError()]
)
def test_classify_unknown_is_permanent(err):
    assert classify(err) == "permanent"


def _spec(name: str, effect: str) -> ToolSpec:
    return ToolSpec(name, "d", {"type": "object"}, effect=effect)


def test_safe_to_retry_read_only():
    assert safe_to_retry(_spec("search_notes", "read"))
    assert not safe_to_retry(_spec("save_note", "change"))


def test_pay_and_delete_never_safe():
    assert not safe_to_retry(_spec("delete_cache", "read"))
    assert not safe_to_retry(_spec("app__pay_invoice", "read"))
