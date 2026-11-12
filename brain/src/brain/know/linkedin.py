"""The LinkedIn source: only the PDF the person saves from their own profile ("Save to PDF").

No browser automation and no API. The text is pulled out locally so facts can be checked
against it; the PDF itself also goes to the model as a document block. An image-only or
non-PDF file is a gap, never guessed facts.
"""

import base64
import io

from pypdf import PdfReader

from brain.know.facts import Known, Material
from brain.know.source import SourceGap


def pdf_text(data: bytes) -> list[str]:
    """One string per page; any parser trouble gives no text at all."""
    try:
        return [(page.extract_text() or "") for page in PdfReader(io.BytesIO(data)).pages]
    except Exception:  # pypdf raises many kinds for broken files; all mean "unreadable"
        return []


class LinkedinSource:
    name = "linkedin"
    needs = "file"
    label = "LinkedIn PDF"

    async def read(self, given: str | bytes | None, known: Known) -> list[Material]:
        if not isinstance(given, bytes) or not given.startswith(b"%PDF"):
            raise SourceGap("Couldn't read the PDF.")
        pages = pdf_text(given)
        if not any(p.strip() for p in pages):
            raise SourceGap("The PDF has no readable text (is it an image?).")
        document = {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.b64encode(given).decode("ascii"),
            },
        }
        return [Material("\n".join(pages), "linkedin.pdf", document=document)]
