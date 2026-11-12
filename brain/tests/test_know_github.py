"""The GitHub source on a mock transport: no real request is ever made."""

import base64

import httpx2
import pytest

from brain.know.facts import Known
from brain.know.github import GithubSource
from brain.know.source import SourceGap

USER = {
    "login": "amyb",
    "name": "Amy Brown",
    "bio": "I build CLIs",
    "company": "@Acme Corp",
    "blog": "https://amy.dev",
    "location": "Leeds",
    "twitter_username": "amyb_x",
}
REPOS = [
    {
        "name": "foo",
        "description": "A fast linter",
        "language": "Rust",
        "topics": ["lint"],
        "fork": False,
    },
    {"name": "bar", "description": "Forked thing", "language": "Go", "topics": [], "fork": True},
]


def source(handler):
    return GithubSource(httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))


def ok_handler(user=USER, repos=REPOS, readme="# Hi, I am Amy"):
    def handler(request: httpx2.Request) -> httpx2.Response:
        path = request.url.path
        if path == "/users/amyb":
            return httpx2.Response(200, json=user)
        if path == "/users/amyb/repos":
            return httpx2.Response(200, json=repos)
        if path == "/repos/amyb/amyb/readme":
            if readme is None:
                return httpx2.Response(404)
            return httpx2.Response(
                200, json={"content": base64.b64encode(readme.encode()).decode()}
            )
        return httpx2.Response(404)

    return handler


async def test_github_reads_profile_repos_readme():
    [m] = await source(ok_handler()).read("amyb", Known())
    assert "I build CLIs" in m.text and "A fast linter" in m.text and "Hi, I am Amy" in m.text
    assert m.ref == "github:amyb"
    assert m.keys.handle == "amyb" and m.keys.name == "Amy Brown"
    assert m.keys.employer == "Acme Corp"  # the leading @ is stripped
    assert "https://amy.dev" in m.keys.urls


async def test_github_skips_forks_and_caps_30():
    repos = [
        {"name": f"r{i}", "description": "d", "language": "Go", "topics": [], "fork": False}
        for i in range(40)
    ]
    repos.append(
        {"name": "forked", "description": "f", "language": None, "topics": [], "fork": True}
    )
    [m] = await source(ok_handler(repos=repos)).read("amyb", Known())
    assert "r29" in m.text and "r30" not in m.text and "forked" not in m.text


async def test_github_unknown_user_is_gap():
    handler = lambda request: httpx2.Response(404)  # noqa: E731
    with pytest.raises(SourceGap, match="No GitHub user 'amyb'"):
        await source(handler).read("amyb", Known())


@pytest.mark.parametrize("status", [403, 429])
async def test_github_rate_limited_is_gap(status):
    handler = lambda request: httpx2.Response(status)  # noqa: E731
    with pytest.raises(SourceGap, match="hourly limit"):
        await source(handler).read("amyb", Known())


async def test_github_missing_readme_ok():
    [m] = await source(ok_handler(readme=None)).read("amyb", Known())
    assert "README:" not in m.text


async def test_github_network_error_is_gap():
    def handler(request):
        raise httpx2.ConnectError("down")

    with pytest.raises(SourceGap, match="Couldn't reach GitHub"):
        await source(handler).read("amyb", Known())


async def test_github_makes_no_request_with_bad_username():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx2.Response(200, json={})

    with pytest.raises(SourceGap, match="No GitHub user"):
        await source(handler).read("bad name/../x", Known())
    assert calls == []


async def test_github_server_error_is_unreachable_not_unknown_user():
    handler = lambda request: httpx2.Response(500)  # noqa: E731
    with pytest.raises(SourceGap, match="Couldn't reach GitHub"):
        await source(handler).read("amyb", Known())
