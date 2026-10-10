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


def _google_docs_pdf(lines):
    """A PDF shaped like a Google Docs export: every word *and every space* in its own
    q/cm/BT block under a flipped text matrix. pypdf's default extraction puts each of
    those on its own line, which breaks phrase search on real resumes."""
    import io
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    w = PdfWriter()
    page = w.add_blank_page(612, 792)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                             NameObject("/Subtype"): NameObject("/Type1"),
                             NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): w._add_object(font)})})
    ops, y = ["1 0 0 -1 0 792 cm"], 50
    for line in lines:
        x = 0
        for tok in line.replace(" ", "\0 \0").split("\0"):
            ops.append(f"q .75 0 0 .75 36 {y} cm BT /F1 13.33 Tf 1 0 0 -1 0 0 Tm "
                       f"{x:.2f} -12 Td ({tok}) Tj ET Q")
            x += 7.4 * len(tok)
        y += 16
    stream = DecodedStreamObject()
    stream.set_data("\n".join(ops).encode("latin-1"))
    page[NameObject("/Contents")] = w._add_object(stream)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def test_google_docs_pdf_keeps_words_on_their_line(tmp_path):
    lines = ["Lecturer in Digital Media Marketing at a college of technology",
             "Built a fashion brand from a single Shopee listing to 2B VND revenue",
             "Grew a cross-platform community on a small ad budget"]
    p = tmp_path / "gdocs.pdf"
    p.write_bytes(_google_docs_pdf(lines))
    res = pdftext.extract(p)
    assert res["ok"] is True
    assert res["text"].split("\n") == lines


def test_unreadable_pdf_is_marked_not_readable(tmp_path):
    """Corrupt != image-only. The server refuses the first and accepts the second,
    so the flags must stay distinct."""
    p = tmp_path / "broken.pdf"
    p.write_bytes(b"%PDF-1.4\nnot really a pdf\n")
    res = pdftext.extract(p)
    assert res["readable"] is False and res["ok"] is False
