"""The node's http relay as the brain sees it: a line that is not a JSON-RPC message is answered
rather than left hanging, and a line past the cap ends the pipe. No server is reached.
"""

import asyncio
import json

from brain.node.relay import MAX_LINE, HttpRelay


async def test_a_line_that_is_not_a_message_is_answered_with_an_error_for_its_id():
    relay = HttpRelay("http://127.0.0.1:1/mcp", [])
    try:
        relay.write(b'{"jsonrpc": "2.0", "id": 7, "method": 5}\n')
        reply = json.loads(await asyncio.wait_for(relay.stdout.readline(), 5))
        assert reply["id"] == 7 and reply["error"]["code"] == -32600
    finally:
        relay.kill()
        await relay.wait()


async def test_a_line_past_the_cap_ends_the_pipe():
    relay = HttpRelay("http://127.0.0.1:1/mcp", [])
    relay.write(b"x" * (MAX_LINE + 1))
    assert await asyncio.wait_for(relay.stdout.read(), 5) == b""
    await relay.wait()
