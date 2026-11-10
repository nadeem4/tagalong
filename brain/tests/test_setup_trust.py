"""Checks who counts as Official: the service's own reversed domain or a vendor allowlist."""

from brain.setup import trust


def test_reversed_domain_namespace_is_official():
    assert trust.is_official_app("com.notion/mcp")
    assert trust.is_official_app("app.linear/mcp")


def test_io_github_is_never_official():
    assert not trust.is_official_app("io.github.notion/mcp")
    assert not trust.is_official_app("io.github.makenotion/notion-mcp-server")


def test_lookalike_namespace_is_a_different_namespace():
    assert trust.namespace("com.notion.evil/mcp") == "com.notion.evil"
    assert not trust.is_official_app("com.notion.evil/mcp")
    assert trust.service_key("com.notion-pro/mcp") == "notion-pro"  # never grouped as "notion"


def test_allowlist_overrides_the_pattern(monkeypatch):
    monkeypatch.setattr(trust, "OFFICIAL_APPS", frozenset({"x.y/z"}))
    assert trust.is_official_app("x.y/z")


def test_not_a_domain_is_community():
    assert not trust.is_official_app("notion")
    assert not trust.is_official_app("/mcp")
    assert not trust.is_official_app("")
    assert not trust.is_official_app("com./mcp")


def test_service_key():
    assert trust.service_key("com.notion/mcp") == "notion"
    assert trust.service_key("app.linear/mcp") == "linear"
    assert trust.service_key("io.github.bob/x") == "bob"


def test_publisher_for_github_namespace_uses_repo():
    assert trust.publisher("io.github.bob/x", "https://github.com/bob/x") == (
        "https://github.com/bob/x"
    )
    assert trust.publisher("io.github.bob/x", "") == "io.github.bob"
    assert trust.publisher("com.notion/mcp", "https://github.com/x/y") == "com.notion"


def test_expert_vendors():
    for expert in (
        "claude-acp",
        "codex-acp",
        "gemini",
        "github-copilot-cli",
        "cursor",
        "junie",
        "goose",
        "kimi",
    ):
        assert trust.is_official_expert(expert)
    assert not trust.is_official_expert("some-other-acp")


def test_third_party_namespaces_for_another_service_are_community():
    for lookalike in (
        "com.mcparmory/notion",
        "com.foreverworks/notion",
        "com.insightfulpipe/notion",
        "com.mcparmory/atlassian-jira",
        "ai.smithery/smithery-notion",
    ):
        assert not trust.is_official_app(lookalike), lookalike


def test_the_service_itself_is_official():
    assert trust.is_official_app("com.notion/mcp")
    assert trust.is_official_app("com.atlassian/atlassian-mcp-server")
    assert trust.is_official_app("app.linear/linear")
