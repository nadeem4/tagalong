"""The capability picture: a short, stable list of what Scout can do right now.

Names and one-line purposes only, sorted and capped, so the system prompt stays small and
cacheable. No schemas and no focus facts: those change every turn and would break the cache.
"""

from dataclasses import dataclass

from brain.protocol import ReadingRow

MAX_APPS = 20  # apps listed before "and K more"; every other group is always shown
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


def _names(prefix: str, names: list[str]) -> str:
    """`prefix` plus sorted names, cut at a comma (never mid-name) to stay one short line."""
    out, rest = prefix, sorted(names)
    for i, name in enumerate(rest):
        piece = name if i == 0 else f", {name}"
        if len(out) + len(piece) > LINE_CHARS * 3:
            return out + ", ..."
        out += piece
    return out if rest else out + "none"


def capability_picture(
    builtin: list[str],
    bodies: list[BodyCaps],
    apps: list[AppCaps],
    experts: list[ExpertCaps],
    ocr: ReadingRow | None = None,
    asks: bool = False,
    know_me_offer: bool = False,
) -> str:
    lines = ["What you can do:", _names("Built in: ", builtin)]
    if bodies:
        lines.append("Bodies (what each can do on screen):")
        lines.extend(
            _names(f"- {b.id} ({b.kind}) tools: ", b.tools)
            for b in sorted(bodies, key=lambda b: b.id)
        )
    if apps:
        lines.append("Apps connected:")
        ordered = sorted(apps, key=lambda a: a.id)
        for a in ordered[:MAX_APPS]:
            purpose = _first_line(a.purpose)
            lines.append(f"- {a.name} ({a.id}): {purpose}" if purpose else f"- {a.name} ({a.id})")
        if len(ordered) > MAX_APPS:
            lines.append(f"... and {len(ordered) - MAX_APPS} more apps not listed")
    else:
        lines.append("Apps connected: none")
    lines.append("Your own work (jobs, timers, what you have not told the owner yet): work_status.")
    lines.append("A step that gave up (work_failed): resolve_step with retry, skip or stop.")
    if asks:  # a fixed line: the argument and its bounds, never Scout's wording
        lines.append(
            "A tool in ask mode takes ask_wait_hours (1 to 168, default 72): how long the ask "
            "waits for the person's yes if they are away."
        )
    if know_me_offer:  # fixed text; code decides when it is due, Scout the wording
        lines.append(
            "You do not know the owner yet. You may offer once, in your own words, to read their "
            "public profiles (get_to_know_me, action offered), and only if it fits the moment."
        )
    if experts:
        lines.append(
            "Experts (for long or many-stepped jobs; each works only with what it is given):"
        )
        lines.extend(
            f"- {e.id}: {_LOGIN[e.logged_in]}" for e in sorted(experts, key=lambda e: e.id)
        )
    else:
        lines.append("Experts: none installed")
    if ocr is not None:  # a fact only; the model words any offer to fix it
        if ocr.state == "needs-language-pack":
            lines.append(
                "Text inside pictures cannot be read on this PC: the Windows language pack for "
                f"{ocr.language or 'the display language'} is missing. The body tool "
                "install_ocr_language can add it, with the person's say-so."
            )
        else:
            lines.append(
                "Text inside pictures cannot be read on this PC right now: "
                "Windows text recognition is not working."
            )
    return "\n".join(lines)
