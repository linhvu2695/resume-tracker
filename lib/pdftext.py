"""Extract searchable text from a resume PDF.

Resumes exported from Word / Google Docs / Canva carry a real text layer and
extract cleanly. A resume that is a *scan* or a flattened raster export has no
text layer: extraction returns (almost) nothing. We detect that case and say so
rather than silently storing an empty file -- the UI surfaces it as a warning.
"""
import re

MIN_CHARS = 120     # below this, assume there is no usable text layer


def extract(pdf_path):
    """-> {"text", "pages", "ok", "readable", "warning"}

    `readable` False means the file could not be opened as a PDF at all -- that is a
    mistake, and the caller refuses it. `readable` True with `ok` False means a valid
    PDF with no text layer (a scan): accepted, but flagged.
    """
    try:
        from pypdf import PdfReader
    except ImportError:
        return {"text": "", "pages": 0, "ok": False, "readable": False,
                "warning": "pypdf is not installed -- run `uv sync`"}
    try:
        reader = PdfReader(str(pdf_path))
        chunks = []
        for page in reader.pages:
            chunks.append(_page_text(page))
        text = normalize("\n".join(chunks))
        pages = len(reader.pages)
    except Exception as e:
        return {"text": "", "pages": 0, "ok": False, "readable": False,
                "warning": f"could not read the PDF: {e}"}

    if len(text) < MIN_CHARS:
        return {"text": text, "pages": pages, "ok": False, "readable": True,
                "warning": f"only {len(text)} characters of text -- this looks like a scanned "
                           f"or image-based PDF, so search and tailoring will not work on it"}
    return {"text": text, "pages": pages, "ok": True, "readable": True, "warning": None}


def _page_text(page):
    """Layout mode first: Google Docs exports draw every word in its own text block, and
    pypdf's default mode emits each one on its own line -- phrase search then never
    matches. Layout mode rebuilds lines from glyph positions. Plain mode is the fallback
    for the PDFs layout mode chokes on."""
    for mode in ("layout", "plain"):
        try:
            return page.extract_text(extraction_mode=mode) or ""
        except Exception:
            continue
    return ""


def normalize(text):
    """Collapse the ragged whitespace PDF extraction produces, keeping line structure."""
    text = text.replace("\xa0", " ").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()
