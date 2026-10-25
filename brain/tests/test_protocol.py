"""Checks every sample frame in protocol/examples against the pydantic types.

The TypeScript tests read the same files, so drift between the two implementations shows
up as a failing example. Both harnesses check the filename convention the same way.
"""

import json
from pathlib import Path

import pytest
from pydantic import BaseModel, ValidationError

from brain.protocol import (
    BODY_TO_BRAIN,
    BRAIN_TO_BODY,
    LIMITS,
    PROTOCOL,
    Body,
    ErrorCode,
    ErrorObject,
    Tool,
)

ROOT = Path(__file__).parents[2] / "protocol" / "examples"
MAPS = {"body": BODY_TO_BRAIN, "brain": BRAIN_TO_BODY}
KINDS = {"params", "result", "error"}


def load(directory: str) -> list[tuple[str, dict, str, str, str]]:
    """Return (file, frame, from, method, kind) per example, checking the filename."""
    samples = []
    for path in sorted((ROOT / directory).glob("*.json")):
        parts = path.name.removesuffix(".json").split(".")
        assert len(parts) >= 3, f"{path.name}: too few segments"
        origin, method, kind = parts[:3]
        assert origin in MAPS, f"{path.name}: bad <from>"
        assert method in MAPS[origin], f"{path.name}: unknown method for {origin}"
        assert kind in KINDS, f"{path.name}: bad <kind>"
        if directory == "invalid":
            assert len(parts) >= 4, f"{path.name}: invalid files need a <why>"
        frame = json.loads(path.read_text(encoding="utf-8"))
        assert kind in frame, f"{path.name}: frame has no {kind}"
        if kind == "params":
            assert frame["method"] == method, f"{path.name}: method differs from filename"
        samples.append((path.name, frame, origin, method, kind))
    return samples


def model_for(origin: str, method: str, kind: str) -> type[BaseModel]:
    if kind == "error":
        return ErrorObject
    params, result = MAPS[origin][method]
    model = params if kind == "params" else result
    assert model is not None, f"{origin}.{method} has no {kind}"
    return model


VALID = load("valid")
INVALID = load("invalid")


@pytest.mark.parametrize("sample", VALID, ids=[s[0] for s in VALID])
def test_valid_example_parses(sample):
    _, frame, origin, method, kind = sample
    assert frame["jsonrpc"] == "2.0"
    model_for(origin, method, kind).model_validate(frame[kind])


@pytest.mark.parametrize("sample", INVALID, ids=[s[0] for s in INVALID])
def test_invalid_example_is_rejected(sample):
    _, frame, origin, method, kind = sample
    with pytest.raises(ValidationError):
        model_for(origin, method, kind).model_validate(frame[kind])


@pytest.mark.parametrize("origin", ["body", "brain"])
def test_every_method_has_examples(origin):
    for method, (_, result) in MAPS[origin].items():
        have = {s[4] for s in VALID if s[2] == origin and s[3] == method}
        assert "params" in have, f"{origin}.{method} params"
        if result is not None:
            assert "result" in have, f"{origin}.{method} result"


def test_constants():
    assert PROTOCOL == 1
    assert LIMITS == {
        "part_bytes": 5_000_000,
        "message_bytes": 20_000_000,
        "replay_count": 500,
        "replay_ms": 86_400_000,
    }


def test_error_codes():
    assert {c.name: c.value for c in ErrorCode} == {
        "parse_error": -32700,
        "invalid_request": -32600,
        "method_not_found": -32601,
        "invalid_params": -32602,
        "internal_error": -32603,
        "version_mismatch": -32000,
        "unknown_tool": -32001,
        "not_found": -32002,
        "denied": -32003,
        "timeout": -32004,
        "cancelled": -32005,
        "body_offline": -32006,
        "tool_failed": -32007,
        "over_limit": -32008,
    }


def tool(name: str) -> dict:
    return {"name": name, "description": "d", "input_schema": {}}


def test_tool_name_length_edges():
    Tool.model_validate(tool("a" * 48))
    for bad in ("a" * 49, ""):
        with pytest.raises(ValidationError):
            Tool.model_validate(tool(bad))


def test_body_id_length_edges():
    Body.model_validate({"id": "a" * 32, "kind": "k", "name": "n"})
    with pytest.raises(ValidationError):
        Body.model_validate({"id": "a" * 33, "kind": "k", "name": "n"})


def test_strict_types():
    hello = {"protocol": True, "body": {"id": "d", "kind": "k", "name": "n"}, "tools": []}
    params = BODY_TO_BRAIN["hello"][0]
    with pytest.raises(ValidationError):
        params.model_validate(hello)
    # A newer protocol number is a valid message; the server answers version_mismatch.
    params.model_validate({**hello, "protocol": 2})


def test_seq_bounds():
    reply = {"seq": 0, "turn": "t", "body": "b", "done": True}
    with pytest.raises(ValidationError):
        BRAIN_TO_BODY["reply"][0].model_validate(reply)
    result = {"protocol": 1, "session": "s", "tools": [], "seq": 0, "resync": False}
    BODY_TO_BRAIN["hello"][1].model_validate(result)
    # Python-only: JSON.parse cannot tell 1 from 1.0, so this is not a shared example.
    with pytest.raises(ValidationError):
        ErrorObject.model_validate({"code": -32007.0, "message": "m"})


def test_null_allowed_only_where_nullable():
    reply = BRAIN_TO_BODY["reply"][0]
    reply.model_validate({"seq": 1, "turn": "t", "body": None, "done": True})
    BRAIN_TO_BODY["turn"][0].model_validate(
        {"seq": 1, "turn": "t", "body": None, "state": "started"}
    )
    BODY_TO_BRAIN["event"][0].model_validate({"name": "n", "data": None})
    BODY_TO_BRAIN["say"][0].model_validate({"text": "hi", "context": None})
    ErrorObject.model_validate({"code": -32007, "message": "m", "data": None})


@pytest.mark.parametrize(
    ("origin", "method", "params"),
    [
        ("body", "say", {"text": None}),
        ("body", "say", {"text": "hi", "parts": None}),
        ("body", "answer", {"ask": "a", "option": "o", "text": None}),
        ("brain", "turn", {"seq": 1, "turn": "t", "body": "b", "state": "ended", "reason": None}),
        (
            "brain",
            "tool",
            {"seq": 1, "turn": "t", "call": "c", "name": "n", "state": "ended", "ok": None},
        ),
        (
            "brain",
            "ask",
            {"seq": 1, "id": "a", "state": "closed", "reason": "answered", "by": None},
        ),
        (
            "brain",
            "ask",
            {"seq": 1, "id": "a", "state": "open", "text": "t", "options": [], "turn": None},
        ),
    ],
)
def test_null_rejected_on_optional_fields(origin, method, params):
    with pytest.raises(ValidationError):
        MAPS[origin][method][0].model_validate(params)
