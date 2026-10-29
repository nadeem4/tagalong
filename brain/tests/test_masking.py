"""Masker and the mask_secrets save guard: fake secrets only, no real keys."""

import json
from urllib.parse import quote

import pytest

from brain.apps import Apps, TokenFile
from brain.guards import Guards, Hook, SaveCtx
from brain.masking import Masker, mask_json, mask_secrets


def test_masks_an_exact_value():
    m = Masker(lambda: ["hunter2-hunter2"])
    assert m.mask("pw is hunter2-hunter2 ok") == "pw is [secret] ok"


def test_ignores_values_shorter_than_eight_chars():
    assert Masker(lambda: ["abc"]).mask("abc def") == "abc def"


def test_masks_longest_value_first():
    m = Masker(lambda: ["abcdefgh", "abcdefgh-long-tail"])
    assert m.mask("x abcdefgh-long-tail y") == "x [secret] y"


def test_skips_empty_and_none_values():
    assert Masker(lambda: ["", None, "12345678"]).mask("a 12345678") == "a [secret]"


@pytest.mark.parametrize(
    "text,expected",
    [
        ("k sk-ant-" + "a" * 24 + " z", "k [secret] z"),
        ("Authorization: Bearer " + "A1b2C3d4E5f6G7h8.x", "Authorization: Bearer [secret]"),
        ("t ghp_" + "a" * 36, "t [secret]"),
        ("t xoxb-1234567890-abc", "t [secret]"),
        ("id AKIA" + "ABCDEFGHIJKLMNOP", "id [secret]"),
    ],
)
def test_masks_each_key_shape(text, expected):
    assert Masker(lambda: []).mask(text) == expected


def test_url_token_keeps_param_name():
    m = Masker(lambda: [])
    assert m.mask("https://x/y?token=abc12345&a=1") == "https://x/y?token=[secret]&a=1"
    assert (
        m.mask('get "https://x/y?a=1&api_key=zzz" now')
        == 'get "https://x/y?a=1&api_key=[secret]" now'
    )


def test_clean_text_is_untouched_and_rewrite_not_returned():
    g = mask_secrets(Masker(lambda: ["12345678"]))
    assert g.hook is Hook.save
    guards = Guards()
    guards.add(g)
    v = guards.run_sync(Hook.save, SaveCtx("chat", "nothing here"))
    assert v.kind == "allow"
    v = guards.run_sync(Hook.save, SaveCtx("chat", "has 12345678"))
    assert (v.kind, v.value) == ("rewrite", "has [secret]")


def _guards(values=lambda: ["12345678"]):
    guards = Guards()
    guards.add(mask_secrets(Masker(values)))
    return guards


def test_mask_json_walks_tool_use_input_and_tool_result_blocks():
    obj = [
        {"type": "tool_use", "id": "t1", "name": "n", "input": {"q": ["a 12345678"], "n": 3}},
        {
            "type": "tool_result",
            "tool_use_id": "t1",
            "content": [{"type": "text", "text": "12345678"}],
        },
    ]
    out = mask_json(_guards(), "chat", obj)
    assert out[0]["input"] == {"q": ["a [secret]"], "n": 3}
    assert out[1]["content"][0]["text"] == "[secret]"
    assert out[0]["id"] == "t1"


def test_mask_json_does_not_mutate_the_original():
    obj = {"a": ["12345678"]}
    mask_json(_guards(), "chat", obj)
    assert obj == {"a": ["12345678"]}


def test_save_guard_raising_withholds():
    def boom():
        raise RuntimeError("no")

    assert mask_json(_guards(boom), "chat", {"a": "text"}) == {"a": "[withheld]"}


def test_values_are_read_fresh_each_time():
    vals = []
    m = Masker(lambda: vals)
    assert m.mask("late 87654321") == "late 87654321"
    vals.append("87654321")
    assert m.mask("late 87654321") == "late [secret]"


def test_apps_secret_values_include_tokens_url_params_and_oauth(tmp_path):
    tokens = TokenFile(tmp_path)
    tokens.set("a1", "bearer-token-value")
    tokens.set("a1:env:KEY", "env-secret-value")
    userinfo = quote("user:p@ss word!", safe="")
    tokens.set("a1:url_query", f"x=plainvalue1&__userinfo={userinfo}")
    oauth = tmp_path / "app-oauth"
    oauth.mkdir()
    (oauth / "a1.json").write_text(
        json.dumps({"tokens": {"access_token": "acc-tok-123", "refresh_token": "ref-tok-456"}})
    )
    apps = Apps(memory=None, notify=lambda *a: None, env={}, tokens=tokens, data_dir=tmp_path)
    vals = apps.secret_values()
    for v in ("bearer-token-value", "env-secret-value", "plainvalue1", "user:p@ss word!"):
        assert v in vals
    assert "acc-tok-123" in vals and "ref-tok-456" in vals
