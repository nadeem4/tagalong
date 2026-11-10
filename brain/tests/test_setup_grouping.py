"""Checks grouping: Official heads a service, Community joins by name, off-topic sinks."""

from brain.setup.grouping import group_entries
from brain.setup.registry import Distribution, RegistryEntry


def entry(id: str, title: str = "", description: str = "") -> RegistryEntry:
    return RegistryEntry(id, title or id, "1", description, "", [Distribution("remote", url="u")])


def test_official_entry_heads_its_group_and_community_joins_by_name():
    groups = group_entries(
        [
            entry("io.github.amy/podcast-editor"),
            entry("io.github.bob/notion-tools"),
            entry("com.notion/mcp", "Notion"),
        ],
        "notion",
    )
    assert groups[0].service == "notion"
    assert groups[0].official.id == "com.notion/mcp"
    assert [e.id for e in groups[0].others] == ["io.github.bob/notion-tools"]


def test_off_topic_sinks_below_matches():
    groups = group_entries(
        [entry("io.github.amy/podcast-editor"), entry("io.github.bob/notion-tools")], "notion"
    )
    assert [e.id for e in groups[-1].others] == ["io.github.amy/podcast-editor"]
    assert [e.id for e in groups[0].others] == ["io.github.bob/notion-tools"]


def test_group_without_official_says_so_and_lists_all():
    groups = group_entries([entry("io.github.a/foo-one"), entry("io.github.b/foo-two")], "foo")
    assert len(groups) == 1 and groups[0].official is None
    assert len(groups[0].others) == 2


def test_lookalike_never_becomes_head():
    groups = group_entries(
        [entry("io.github.notion/mcp"), entry("com.notion.evil/mcp", "Notion Pro")], "notion"
    )
    assert all(g.official is None for g in groups)


def test_lookalike_does_not_take_the_official_head():
    groups = group_entries(
        [entry("com.notion.labs/x", "Notion Labs"), entry("com.notion/mcp", "Notion")], "notion"
    )
    assert groups[0].official.id == "com.notion/mcp"
    assert [e.id for e in groups[0].others] == ["com.notion.labs/x"]


def test_two_officials_same_key_shortest_namespace_heads():
    # Two entries of one service: the first of equal length heads, the other is listed under it.
    groups = group_entries([entry("com.notion/mcp"), entry("com.notion/legacy")], None)
    assert groups[0].official.id == "com.notion/mcp"
    assert [e.id for e in groups[0].others] == ["com.notion/legacy"]


def test_no_query_groups_each_service_once():
    groups = group_entries(
        [entry("com.notion/mcp"), entry("io.github.z/thing", "Thing"), entry("app.linear/mcp")],
        None,
    )
    assert [g.service for g in groups] == ["notion", "linear", "Thing"]
    assert groups[2].official is None


def test_third_party_notion_wrappers_never_head_the_notion_group():
    groups = group_entries(
        [
            entry("com.mcparmory/notion", "Notion"),
            entry("com.foreverworks/notion", "Notion"),
            entry("com.notion/mcp", "Notion"),
        ],
        "notion",
    )
    assert groups[0].official.id == "com.notion/mcp"
    assert {e.id for e in groups[0].others} == {"com.mcparmory/notion", "com.foreverworks/notion"}
    lone = group_entries([entry("com.mcparmory/atlassian-jira", "Jira")], "atlassian")
    assert all(g.official is None for g in lone)
