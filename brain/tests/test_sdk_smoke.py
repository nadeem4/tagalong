"""Pins the mcp SDK names the connected-apps code relies on.

The 2.x client differs from 1.x (httpx2 client passed in, snake_case annotation fields), so
this fails loudly if a version bump renames anything later tasks depend on.
"""

import inspect

import mcp
import mcp.types as t
from mcp.client.auth import OAuthClientProvider, TokenStorage
from mcp.client.session import IncomingMessage
from mcp.client.stdio import StdioServerParameters, get_default_environment, stdio_client
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client
from mcp.shared.auth import OAuthClientMetadata


def test_sdk_imports():
    params = inspect.signature(mcp.ClientSession.__init__).parameters
    assert "message_handler" in params
    assert callable(stdio_client) and callable(get_default_environment)
    assert {"command", "args", "env"} <= set(StdioServerParameters.model_fields)
    for name in ("initialize", "list_tools", "call_tool"):
        assert inspect.iscoroutinefunction(getattr(mcp.ClientSession, name))


def test_http_client_takes_an_httpx_client_for_auth_and_headers():
    assert list(inspect.signature(streamable_http_client).parameters)[:2] == ["url", "http_client"]
    assert {"headers", "auth"} <= set(inspect.signature(create_mcp_http_client).parameters)


def test_oauth_surface():
    params = set(inspect.signature(OAuthClientProvider.__init__).parameters)
    assert {
        "server_url",
        "client_metadata",
        "storage",
        "redirect_handler",
        "callback_handler",
    } <= params
    assert {"get_tokens", "set_tokens", "get_client_info", "set_client_info"} <= set(
        dir(TokenStorage)
    )
    assert {"client_name", "redirect_uris", "grant_types"} <= set(OAuthClientMetadata.model_fields)


def test_tool_annotations_and_list_changed_notification():
    assert {"read_only_hint", "destructive_hint"} <= set(t.ToolAnnotations.model_fields)
    ann = t.ToolAnnotations(readOnlyHint=True)
    assert ann.read_only_hint is True
    assert t.ToolListChangedNotification in IncomingMessage.__args__
