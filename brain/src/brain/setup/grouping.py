"""Groups registry results per service so Home shows one card per service, Official first.

Only `trust.is_official_app` decides who heads a group; matching a name never makes anything
Official, so a lookalike title cannot take the top spot.
"""

import re
from dataclasses import dataclass, field

from brain.setup.registry import RegistryEntry
from brain.setup.trust import is_official_app, namespace, service_key


@dataclass(frozen=True)
class Group:
    service: str
    official: RegistryEntry | None = None
    others: list[RegistryEntry] = field(default_factory=list)


def _text(e: RegistryEntry) -> str:
    return f"{e.id.partition('/')[2]} {e.name}".lower()


def group_entries(entries: list[RegistryEntry], query: str | None) -> list[Group]:
    q = query.strip().lower() if query and query.strip() else None
    heads: dict[str, RegistryEntry] = {}
    others: dict[str, list[RegistryEntry]] = {}
    for e in entries:
        if not is_official_app(e.id):
            continue
        # Keyed by the whole namespace: `io.notion` is another publisher than `com.notion`.
        key = namespace(e.id)
        if key not in heads:
            heads[key] = e
        else:
            others.setdefault(key, []).append(e)
    singles: list[Group] = []  # community entries that matched nothing and have no query
    off_topic: list[Group] = []
    query_group: list[RegistryEntry] = []
    for e in entries:
        if is_official_app(e.id):
            continue
        text = _text(e)
        words = set(re.split(r"[^a-z0-9]+", text))
        key = next((k for k, h in heads.items() if service_key(h.id) in words), None)
        if key:
            others.setdefault(key, []).append(e)
        elif q and q in text:
            query_group.append(e)
        elif q:
            off_topic.append(Group(e.name, None, [e]))
        else:
            singles.append(Group(e.name, None, [e]))
    groups = [Group(service_key(h.id), h, others.get(k, [])) for k, h in heads.items()]
    if q and query_group:
        groups.append(Group(q, None, query_group))
    matching = [g for g in groups if not q or _group_matches(g, q)]
    rest = [g for g in groups if g not in matching]
    # Official heads first, then groups matching the query, off-topic ones last.
    matching.sort(key=lambda g: g.official is None)
    return matching + singles + rest + off_topic


def _group_matches(g: Group, q: str) -> bool:
    members = ([g.official] if g.official else []) + g.others
    return q in g.service.lower() or any(q in _text(m) for m in members)
