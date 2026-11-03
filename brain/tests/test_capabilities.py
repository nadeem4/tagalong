"""Tests for the capability picture: what Scout sees it can do, as names and one-line purposes."""

from brain.mind.capabilities import (
    AppCaps,
    BodyCaps,
    ExpertCaps,
    capability_picture,
)


def picture(**kw):
    args = {"builtin": [], "bodies": [], "apps": [], "experts": []}
    args.update(kw)
    return capability_picture(**args)


def test_empty_state_says_so_plainly():
    out = picture()
    assert "Built in: none" in out
    assert "Apps connected: none" in out
    assert "Experts: none installed" in out
    assert "Bodies" not in out


def test_two_bodies_list_their_tool_names_sorted_by_body():
    out = picture(
        bodies=[
            BodyCaps("desktop", "desktop", ["open_url"]),
            BodyCaps("browser", "extension", ["tab_read", "tab_open"]),
        ]
    )
    lines = out.splitlines()
    first = next(i for i, ln in enumerate(lines) if ln.startswith("- browser"))
    assert lines[first] == "- browser (extension) tools: tab_open, tab_read"
    assert lines[first + 1] == "- desktop (desktop) tools: open_url"


def test_apps_with_and_without_a_purpose():
    out = picture(
        apps=[
            AppCaps("notes", "Notes", ""),
            AppCaps("gmail", "Gmail", "Read and send mail.\nMore."),
        ]
    )
    assert "- Gmail (gmail): Read and send mail." in out
    assert "More." not in out
    assert "- Notes (notes)" in out
    assert out.index("Gmail") < out.index("Notes (notes)")


def test_experts_show_login_state():
    out = picture(
        experts=[
            ExpertCaps("claude-acp", True),
            ExpertCaps("other", False),
            ExpertCaps("fresh", None),
        ]
    )
    assert "- claude-acp: signed in" in out
    assert "- other: needs sign-in" in out
    assert "- fresh: sign-in not checked" in out


def test_builtin_names_only_and_no_schemas():
    out = picture(builtin=["set_timer", "remember"])
    assert "Built in: remember, set_timer" in out
    assert "{" not in out and "input_schema" not in out


def test_output_is_capped_and_stable():
    apps = [AppCaps(f"a{i:03}", f"App {i}", "does things") for i in range(200)]
    out = picture(apps=apps)
    assert len(out.splitlines()) <= 40
    assert out == picture(apps=list(reversed(apps)))
    assert "more" in out.splitlines()[-1]
