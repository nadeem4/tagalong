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
    assert "more apps" in out
    assert out.splitlines()[-1] == "Experts: none installed"
    assert "Built in: none" in out


def test_experts_and_builtin_survive_many_apps():
    apps = [AppCaps(f"a{i:03}", f"App {i}", "x") for i in range(200)]
    out = picture(builtin=["remember"], apps=apps, experts=[ExpertCaps("claude-acp", True)])
    assert "- claude-acp: signed in" in out
    assert "Built in: remember" in out


def test_long_lines_are_cut_whole_never_mid_name():
    names = [f"tool_number_{i:03}" for i in range(60)]
    out = picture(builtin=names, bodies=[BodyCaps("desk", "desktop", names)])
    for line in out.splitlines():
        assert len(line) <= 500
        assert not line.endswith(("tool_number_0", "tool_n"))
    built = next(ln for ln in out.splitlines() if ln.startswith("Built in:"))
    assert built.endswith(("...", names[-1]))
    assert all(
        n in names for n in built.removeprefix("Built in: ").removesuffix(", ...").split(", ")
    )


def ocr(state, language=None):
    from brain.protocol import ReadingRow

    return ReadingRow(
        capability="text-from-pictures",
        engine="windows-ocr",
        where="this-pc",
        state=state,
        **({"language": language} if language else {}),
    )


def test_the_picture_has_no_reading_line_when_ocr_works():
    assert "pictures" not in picture()
    assert "pictures" not in picture(ocr=None)


def test_the_picture_says_text_in_pictures_is_not_readable_when_the_pack_is_missing():
    out = picture(ocr=ocr("needs-language-pack", "en-US"))
    assert "Text inside pictures cannot be read on this PC" in out
    assert "language pack for en-US" in out
    assert "install_ocr_language" in out


def test_the_picture_says_not_working_without_offering_the_install_tool():
    out = picture(ocr=ocr("not-working"))
    assert "Text inside pictures cannot be read on this PC" in out
    assert "install_ocr_language" not in out
