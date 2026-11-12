"""The source protocol and material types: gap text, defaults, and the shared fake."""

from know_fakes import FakeSource

from brain.know.facts import Known, Material
from brain.know.source import KnowSource, SourceGap


def test_gap_message_is_str():
    assert str(SourceGap("No GitHub user 'x'.")) == "No GitHub user 'x'."


def test_material_defaults():
    m = Material("text", "ref")
    assert m.document is None and m.keys == Known()
    assert Known().urls == () and Known().handle is None


async def test_fake_source_satisfies_protocol():
    src: KnowSource = FakeSource("github")
    assert src.name == "github" and src.needs == "none" and src.label
    assert (await src.read(None, Known()))[0].ref == "ref"
