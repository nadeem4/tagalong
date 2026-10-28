"""A fake OAuth-protected MCP server for the sign-in tests: `python fake_oauth_server.py PORT`.

Serves the fake MCP app at /mcp behind a bearer check, plus discovery metadata, dynamic client
registration, authorize (redirects straight back with a code) and token (code and refresh grants).
The refresh token "bad" is always refused, so tests can reach the full sign-in path.
"""

import sys
from urllib.parse import urlencode

import uvicorn
from fake_mcp_server import server
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.routing import Route

GOOD_TOKENS = {"good-token", "refreshed-token"}
CODE = "fake-code"


def build(port: int) -> object:
    base = f"http://127.0.0.1:{port}"
    mcp_app = server.streamable_http_app()

    async def resource_metadata(_: Request) -> Response:
        return JSONResponse({"resource": f"{base}/mcp", "authorization_servers": [base]})

    async def as_metadata(_: Request) -> Response:
        return JSONResponse(
            {
                "issuer": base,
                "authorization_endpoint": f"{base}/authorize",
                "token_endpoint": f"{base}/token",
                "registration_endpoint": f"{base}/register",
                "response_types_supported": ["code"],
                "grant_types_supported": ["authorization_code", "refresh_token"],
                "code_challenge_methods_supported": ["S256"],
                "token_endpoint_auth_methods_supported": ["none"],
            }
        )

    async def register(request: Request) -> Response:
        meta = await request.json()
        return JSONResponse({**meta, "client_id": "fake-client"}, status_code=201)

    async def authorize(request: Request) -> Response:
        q = request.query_params
        back = urlencode({"code": CODE, "state": q["state"]})
        return RedirectResponse(f"{q['redirect_uri']}?{back}", status_code=302)

    async def token(request: Request) -> Response:
        form = await request.form()
        if form.get("grant_type") == "authorization_code" and form.get("code") == CODE:
            access, refresh = "good-token", "r1"
        elif form.get("grant_type") == "refresh_token" and form.get("refresh_token") != "bad":
            access, refresh = "refreshed-token", "r2"
        else:
            return JSONResponse({"error": "invalid_grant"}, status_code=400)
        return JSONResponse(
            {
                "access_token": access,
                "token_type": "Bearer",
                "expires_in": 3600,
                "refresh_token": refresh,
            }
        )

    async def revoke(_: Request) -> Response:
        GOOD_TOKENS.clear()  # every token is refused from now on, like a server-side sign-out
        return Response(status_code=204)

    api = Starlette(
        routes=[
            Route("/revoke", revoke, methods=["POST"]),
            Route("/.well-known/oauth-protected-resource/mcp", resource_metadata),
            Route("/.well-known/oauth-protected-resource", resource_metadata),
            Route("/.well-known/oauth-authorization-server", as_metadata),
            Route("/register", register, methods=["POST"]),
            Route("/authorize", authorize),
            Route("/token", token, methods=["POST"]),
        ]
    )

    async def app(scope, receive, send) -> None:
        if scope["type"] == "lifespan":
            await mcp_app(scope, receive, send)
        elif scope["path"] == "/mcp":
            auth = dict(scope["headers"]).get(b"authorization", b"").decode()
            if auth.removeprefix("Bearer ") not in GOOD_TOKENS:
                url = f"{base}/.well-known/oauth-protected-resource/mcp"
                challenge = f'Bearer resource_metadata="{url}"'
                denied = Response(status_code=401, headers={"WWW-Authenticate": challenge})
                await denied(scope, receive, send)
            else:
                await mcp_app(scope, receive, send)
        else:
            await api(scope, receive, send)

    return app


if __name__ == "__main__":
    port = int(sys.argv[1])
    uvicorn.run(build(port), host="127.0.0.1", port=port, log_level="warning")
