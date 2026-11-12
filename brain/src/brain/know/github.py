"""The GitHub source: a person's public profile, repositories and profile README.

Unauthenticated calls to api.github.com, read only. The profile also tells the web search
what to look for (handle, blog and other links, name, employer), so those ride in `keys`.
"""

import base64
import re

import httpx2

from brain.know.facts import Known, Material
from brain.know.source import SourceGap

API = "https://api.github.com"
USERNAME = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
MAX_REPOS = 30
TIMEOUT = 15.0


class _RateLimited(Exception):
    pass


class GithubSource:
    name = "github"
    needs = "username"
    label = "GitHub"

    def __init__(self, client: httpx2.AsyncClient | None = None) -> None:
        self._client = client

    async def _get(self, client: httpx2.AsyncClient, path: str, **params) -> httpx2.Response:
        res = await client.get(
            API + path,
            params=params or None,
            headers={"Accept": "application/vnd.github+json"},
        )
        if res.status_code in (403, 429):
            raise _RateLimited
        return res

    async def read(self, given: str | bytes | None, known: Known) -> list[Material]:
        user = given if isinstance(given, str) else ""
        if not USERNAME.match(user):
            raise SourceGap(f"No GitHub user '{user}'.")
        client = self._client or httpx2.AsyncClient(timeout=TIMEOUT)
        try:
            profile = await self._get(client, f"/users/{user}")
            if profile.status_code == 404:
                raise SourceGap(f"No GitHub user '{user}'.")
            if profile.status_code != 200:
                raise SourceGap("Couldn't reach GitHub.")
            repos = await self._get(
                client, f"/users/{user}/repos", type="owner", sort="pushed", per_page=100
            )
            readme = await self._get(client, f"/repos/{user}/{user}/readme")
        except _RateLimited:
            raise SourceGap("GitHub's hourly limit was reached. Try again later.") from None
        except httpx2.HTTPError:
            raise SourceGap("Couldn't reach GitHub.") from None
        finally:
            if self._client is None:
                await client.aclose()
        return [_material(user, profile.json(), repos, readme)]


def _material(user: str, p: dict, repos: httpx2.Response, readme: httpx2.Response) -> Material:
    lines = ["Profile:"]
    for label, key in (
        ("Name", "name"),
        ("Bio", "bio"),
        ("Company", "company"),
        ("Location", "location"),
        ("Blog", "blog"),
    ):
        if p.get(key):
            lines.append(f"{label}: {p[key]}")
    own = [r for r in (repos.json() if repos.status_code == 200 else []) if not r.get("fork")]
    lines.append("\nRepositories:")
    for r in own[:MAX_REPOS]:
        extra = " ".join(filter(None, [r.get("language") or "", *(r.get("topics") or [])]))
        lines.append(f"- {r['name']}: {r.get('description') or ''} [{extra}]".rstrip())
    if readme.status_code == 200:
        try:
            text = base64.b64decode(readme.json().get("content", "")).decode("utf-8", "replace")
        except ValueError:
            text = ""
        if text.strip():
            lines.append("\nREADME:\n" + text)
    urls = tuple(u for u in (p.get("blog"),) if u)
    if p.get("twitter_username"):
        urls += (f"https://x.com/{p['twitter_username']}",)
    employer = (p.get("company") or "").strip().lstrip("@").strip() or None
    keys = Known(handle=user, urls=urls, name=p.get("name") or None, employer=employer)
    return Material("\n".join(lines), f"github:{user}", keys=keys)
