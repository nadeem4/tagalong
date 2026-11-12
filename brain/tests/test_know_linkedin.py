"""The LinkedIn PDF source: text out of a real tiny PDF, and a gap for anything unreadable."""

import base64
import io
from pathlib import Path

import pytest
from pypdf import PdfWriter

from brain.know.facts import Known
from brain.know.linkedin import LinkedinSource, pdf_text
from brain.know.source import SourceGap

SAMPLE = (Path(__file__).parent / "fixtures" / "linkedin_sample.pdf").read_bytes()


def blank_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


async def test_linkedin_extracts_text_and_document_block():
    [m] = await LinkedinSource().read(SAMPLE, Known())
    assert "Software Engineer at Acme Corp" in m.text
    assert m.ref == "linkedin.pdf"
    assert m.document["type"] == "document"
    assert m.document["source"]["media_type"] == "application/pdf"
    assert base64.b64decode(m.document["source"]["data"]) == SAMPLE


async def test_linkedin_not_a_pdf_is_gap():
    with pytest.raises(SourceGap, match="Couldn't read the PDF"):
        await LinkedinSource().read(b"hello, plain text", Known())


async def test_linkedin_image_only_pdf_is_gap():
    with pytest.raises(SourceGap, match="no readable text"):
        await LinkedinSource().read(blank_pdf(), Known())


async def test_linkedin_wrong_kind_of_input_is_gap():
    with pytest.raises(SourceGap, match="Couldn't read the PDF"):
        await LinkedinSource().read("amyb", Known())


def test_pdf_text_swallows_parser_errors():
    assert pdf_text(b"%PDF-1.4 garbage that is not a pdf") == []
