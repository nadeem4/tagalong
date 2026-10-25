"""Contract v1 (protocol/README.md) as pydantic models: shapes, params and results.

The README wins on any disagreement. Models are strict (no "1" for 1, no true for 1),
frozen, and ignore unknown fields so a newer peer's extra keys never break parsing.
Size limits are constants only; enforcing them is the server's job, not the schema's.
"""

from enum import IntEnum
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    field_validator,
    model_validator,
)

PROTOCOL = 1

LIMITS = {
    "part_bytes": 5_000_000,
    "message_bytes": 20_000_000,
    "replay_count": 500,
    "replay_ms": 86_400_000,
}


class ErrorCode(IntEnum):
    parse_error = -32700
    invalid_request = -32600
    method_not_found = -32601
    invalid_params = -32602
    internal_error = -32603
    version_mismatch = -32000
    unknown_tool = -32001
    not_found = -32002
    denied = -32003
    timeout = -32004
    cancelled = -32005
    body_offline = -32006
    tool_failed = -32007
    over_limit = -32008


# An optional field may be absent but never null. Only these accept a JSON null: the nullable
# `body` of reply and turn, and the free-form `data` and `context` payloads.
NULLABLE = {"body", "data", "context"}


class Model(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore", frozen=True)

    @model_validator(mode="before")
    @classmethod
    def _no_explicit_null(cls, values: Any) -> Any:
        if isinstance(values, dict):
            for key, value in values.items():
                if value is None and key in cls.model_fields and key not in NULLABLE:
                    raise ValueError(f"{key} must be omitted rather than null")
        return values


Id = str
Input = dict[str, Any]
# Handshake seqs may be 0 (nothing seen yet); a notification's seq starts at 1.
HandshakeSeq = Annotated[int, Field(ge=0)]
Seq = Annotated[int, Field(ge=1)]


class ErrorObject(Model):
    code: int
    message: str
    data: Any = None

    @field_validator("code")
    @classmethod
    def _known_code(cls, code: int) -> int:
        if code not in ErrorCode:
            raise ValueError("unknown error code")
        return code


# A body declares plain names; the brain adds the `<body>__` prefix, so `__` is reserved.
class Tool(Model):
    name: Annotated[str, Field(pattern=r"^[a-z0-9_-]{1,48}$")]
    description: str
    input_schema: Input
    confirm: bool | None = None

    @field_validator("name")
    @classmethod
    def _no_double_underscore(cls, name: str) -> str:
        if "__" in name:
            raise ValueError("tool names never contain __")
        return name


# No `ref` source in v1: a part must carry `data`, so one with only `ref` fails here.
class TextPart(Model):
    type: Literal["text"]
    text: str


class ImagePart(Model):
    type: Literal["image"]
    mime: str
    data: str


class FilePart(Model):
    type: Literal["file"]
    mime: str
    name: str | None = None
    data: str


Part = Annotated[TextPart | ImagePart | FilePart, Field(discriminator="type")]


class Body(Model):
    id: Annotated[str, Field(pattern=r"^[a-z0-9-]{1,32}$")]
    kind: str
    name: str


class EmptyResult(Model):
    pass


# Body -> brain


# `protocol` is any int so a newer body gets version_mismatch from the handler, not a schema error.
class HelloParams(Model):
    protocol: int
    body: Body
    tools: list[Tool]
    last_seq: HandshakeSeq | None = None


class HelloResult(Model):
    protocol: int
    session: Id
    tools: list[Tool]
    seq: HandshakeSeq
    resync: bool


class ToolsParams(Model):
    tools: list[Tool]


class SayParams(Model):
    text: str | None = None
    parts: list[Part] | None = None
    context: Any = None
    spoken: bool | None = None

    @model_validator(mode="after")
    def _needs_text_or_parts(self) -> "SayParams":
        if self.text is None and self.parts is None:
            raise ValueError("say needs text or parts")
        return self


class SayResult(Model):
    turn: Id
    joined: bool


class EventParams(Model):
    name: str
    data: Any = None


class CallParams(Model):
    tool: str
    input: Input


class CallResult(Model):
    output: list[Part]


class AnswerParams(Model):
    ask: Id
    option: str
    text: str | None = None


class CancelTurnParams(Model):
    turn: Id


class ProgressParams(Model):
    call: Id
    text: str


# Brain -> body


class UseParams(Model):
    call: Id
    tool: str
    input: Input


class UseResult(Model):
    output: list[Part]


class CancelCallParams(Model):
    call: Id


# A reply is either a delta chunk or the single `done`, never both. `body` is null when no
# body is online to show a turn the brain started itself.
class ReplyParams(Model):
    seq: Seq
    turn: Id
    body: str | None
    delta: str | None = None
    done: Literal[True] | None = None

    @model_validator(mode="after")
    def _delta_xor_done(self) -> "ReplyParams":
        if (self.delta is None) == (self.done is None):
            raise ValueError("a reply has either delta or done: true")
        return self


class TurnParams(Model):
    seq: Seq
    turn: Id
    body: str | None
    state: Literal["started", "ended"]
    reason: Literal["done", "cancelled", "error", "over_budget", "step_cap"] | None = None


class ToolParams(Model):
    seq: Seq
    turn: Id
    call: Id
    name: str
    state: Literal["started", "ended"]
    ok: bool | None = None
    summary: str | None = None


class AskOpen(Model):
    seq: Seq
    id: Id
    state: Literal["open"]
    turn: Id | None = None
    text: str
    options: list[str]
    confirm: bool | None = None
    tool: str | None = None
    input: Input | None = None

    @model_validator(mode="after")
    def _confirm_shape(self) -> "AskOpen":
        if self.confirm and (
            self.tool is None or self.input is None or self.options != ["allow", "deny"]
        ):
            raise ValueError('a confirm ask needs tool, input and options ["allow","deny"]')
        return self


class AskClosed(Model):
    seq: Seq
    id: Id
    state: Literal["closed"]
    reason: Literal["answered", "timeout", "cancelled"]
    option: str | None = None
    by: str | None = None


class AskParams(RootModel[Annotated[AskOpen | AskClosed, Field(discriminator="state")]]):
    model_config = ConfigDict(strict=True, frozen=True)


class ChangedParams(Model):
    seq: Seq
    what: str


# Method name -> (params model, result model or None for notifications).
type MethodMap = dict[str, tuple[type[BaseModel], type[BaseModel] | None]]

BODY_TO_BRAIN: MethodMap = {
    "hello": (HelloParams, HelloResult),
    "tools": (ToolsParams, EmptyResult),
    "say": (SayParams, SayResult),
    "event": (EventParams, None),
    "call": (CallParams, CallResult),
    "answer": (AnswerParams, EmptyResult),
    "cancel": (CancelTurnParams, None),
    "progress": (ProgressParams, None),
}

BRAIN_TO_BODY: MethodMap = {
    "use": (UseParams, UseResult),
    "cancel": (CancelCallParams, None),
    "reply": (ReplyParams, None),
    "turn": (TurnParams, None),
    "tool": (ToolParams, None),
    "ask": (AskParams, None),
    "changed": (ChangedParams, None),
}
