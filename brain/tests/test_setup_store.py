"""Checks the installed-expert store: a plain JSON file that survives bad data and other writers.

No process, no network: only a temp folder.
"""

import json

from brain.setup.paths import experts_file
from brain.setup.store import ExpertStore, InstalledExpert


def expert(id="claude-acp", **kw) -> InstalledExpert:
    base = dict(
        id=id,
        name="Claude Code",
        version="0.99.1",
        command=["node", "adapter.js"],
        source="registry",
        logged_in=None,
    )
    return InstalledExpert(**{**base, **kw})


def test_empty_store_lists_nothing(tmp_path):
    assert ExpertStore(tmp_path).list() == []
    assert ExpertStore(tmp_path).get("claude-acp") is None


def test_add_then_list_round_trips(tmp_path):
    store = ExpertStore(tmp_path)
    store.add(expert())
    assert store.list() == [expert()]
    assert store.get("claude-acp") == expert()


def test_add_replaces_the_same_id(tmp_path):
    store = ExpertStore(tmp_path)
    store.add(expert(version="1"))
    store.add(expert(version="2"))
    assert [e.version for e in store.list()] == ["2"]


def test_corrupt_file_lists_nothing_and_keeps_a_bad_copy(tmp_path):
    path = experts_file(tmp_path)
    path.write_text("{not json", encoding="utf-8")
    store = ExpertStore(tmp_path)
    assert store.list() == []
    assert path.with_name(path.name + ".bad").read_text(encoding="utf-8") == "{not json"
    store.add(expert())  # a fresh file can be written afterwards
    assert len(store.list()) == 1


def test_one_bad_row_does_not_hide_the_rest(tmp_path):
    experts_file(tmp_path).write_text(
        json.dumps({"experts": [{"id": 5}, json.loads(json.dumps(expert().__dict__))]}),
        encoding="utf-8",
    )
    assert [e.id for e in ExpertStore(tmp_path).list()] == ["claude-acp"]


def test_a_change_written_by_another_process_shows_on_the_next_list(tmp_path):
    store = ExpertStore(tmp_path)
    store.add(expert())
    ExpertStore(tmp_path).add(expert("gemini", name="Gemini"))  # the CLI, say
    assert [e.id for e in store.list()] == ["claude-acp", "gemini"]


def test_set_login_updates_only_that_expert(tmp_path):
    store = ExpertStore(tmp_path)
    store.add(expert())
    store.add(expert("gemini"))
    store.set_login("gemini", True)
    assert {e.id: e.logged_in for e in store.list()} == {"claude-acp": None, "gemini": True}
    store.set_login("nobody", False)  # unknown id: nothing changes, nothing raises
    assert len(store.list()) == 2


def test_remove_drops_one_and_leaves_no_part_file(tmp_path):
    store = ExpertStore(tmp_path)
    store.add(expert())
    store.add(expert("gemini"))
    store.remove("claude-acp")
    assert [e.id for e in store.list()] == ["gemini"]
    assert not list(tmp_path.glob("*.part"))


def test_which_node_the_command_uses_is_recorded(tmp_path):
    store = ExpertStore(tmp_path)
    store.add(expert(node="private"))
    assert store.get("claude-acp").node == "private"
    store.add(expert("other"))  # an expert with no Node (a binary, a custom one)
    assert store.get("other").node is None
