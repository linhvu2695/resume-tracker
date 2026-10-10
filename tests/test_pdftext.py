from lib import pdftext


def test_normalize_collapses_pdf_whitespace():
    assert pdftext.normalize("a  \t b\r\n\r\n\r\n c \n") == "a b\n\nc"
    assert pdftext.normalize("x\xa0y") == "x y"


def test_image_only_pdf_is_flagged_not_silently_empty(tmp_path):
    """A scanned resume has no text layer. We must warn, not store an empty string
    and pretend search works."""
    p = tmp_path / "scan.pdf"
    p.write_bytes(b"%PDF-1.4\n% not a real pdf\n")
    res = pdftext.extract(p)
    assert res["ok"] is False and res["warning"]


def test_roundtrip_real_pdf(tmp_path):
    reportlab = __import__("importlib").util.find_spec("reportlab")
    if reportlab is None:
        import pytest
        pytest.skip("no PDF generator available")


def test_unreadable_pdf_is_marked_not_readable(tmp_path):
    """Corrupt != image-only. The server refuses the first and accepts the second,
    so the flags must stay distinct."""
    p = tmp_path / "broken.pdf"
    p.write_bytes(b"%PDF-1.4\nnot really a pdf\n")
    res = pdftext.extract(p)
    assert res["readable"] is False and res["ok"] is False
