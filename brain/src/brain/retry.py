"""Which failures are worth another try, and which tools may safely run again.

Only a known transient error on a read-only tool is retried; everything else ends the step
so the person decides. The backoff itself lives in the work store's retry rule.
"""

from typing import Literal

import anthropic

from brain.protocol import ErrorCode, RpcError
from brain.toolbox import ToolSpec

# Spend and destruction are never repeated on a guess, whatever the tool says its effect is.
NEVER_RETRY_WORDS = (
    "pay",
    "purchase",
    "buy",
    "send_money",
    "delete",
    "remove",
    "trash",
    "wipe",
    "forget",
)

_TRANSIENT = (
    TimeoutError,
    ConnectionError,
    anthropic.RateLimitError,
    anthropic.APIConnectionError,  # also covers APITimeoutError
)


def classify(err: BaseException) -> Literal["transient", "permanent"]:
    if isinstance(err, RpcError):
        return "transient" if err.code == ErrorCode.timeout else "permanent"
    return "transient" if isinstance(err, _TRANSIENT) else "permanent"


def safe_to_retry(spec: ToolSpec) -> bool:
    return spec.effect == "read" and not any(word in spec.name for word in NEVER_RETRY_WORDS)
