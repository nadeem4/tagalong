"""The capability picture: a short, stable list of what Scout can do right now.

Names and one-line purposes only, sorted and capped, so the system prompt stays small and
cacheable. No schemas and no focus facts: those change every turn and would break the cache.
"""

from dataclasses import dataclass

MAX_LINES = 40
LINE_CHARS = 160


@dataclass(frozen=True)
class BodyCaps:
    id: str
    kind: str
    tools: list[str]


@dataclass(frozen=True)
class AppCaps:
    id: str
    name: str
    purpose: str  # may be empty


@dataclass(frozen=True)
class ExpertCaps:
    id: str
    logged_in: bool | None


_LOGIN = {True: "signed in", False: "needs sign-in", None: "sign-in not checked"}


def _first_line(text: str) -> str:
    lines = text.strip().splitlines()
    return lines[0].strip()[:LINE_CHARS] if lines else ""


def capability_picture(
    builtin: list[str],
    bodies: list[BodyCaps],
    apps: list[AppCaps],
    experts: list[ExpertCaps],
) -> str:
    lines = ["What you can do:"]
    built = ", ".join(sorted(builtin)) or "none"
    lines.append(f"Built in: {built}"[: LINE_CHARS * 3])
    if bodies:
        lines.append("Bodies (what each can do on screen):")
        for b in sorted(bodies, key=lambda b: b.id):
            lines.append(f"- {b.id} ({b.kind}) tools: {', '.join(sorted(b.tools))}")
    if apps:
        lines.append("Apps connected:")
        for a in sorted(apps, key=lambda a: a.id):
            purpose = _first_line(a.purpose)
            lines.append(f"- {a.name} ({a.id}): {purpose}" if purpose else f"- {a.name} ({a.id})")
    else:
        lines.append("Apps connected: none")
    if experts:
        lines.append(
            "Experts (for long or many-stepped jobs; each works only with what it is given):"
        )
        lines.extend(
            f"- {e.id}: {_LOGIN[e.logged_in]}" for e in sorted(experts, key=lambda e: e.id)
        )
    else:
        lines.append("Experts: none installed")
    if len(lines) > MAX_LINES:
        hidden = len(lines) - (MAX_LINES - 1)
        lines = [*lines[: MAX_LINES - 1], f"... and {hidden} more lines not shown"]
    return "\n".join(lines)
