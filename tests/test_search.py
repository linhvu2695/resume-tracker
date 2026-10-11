import server


def test_phrase_matches_across_a_line_wrap():
    """A resume wraps wherever the layout says, so "64K+ community" can be split by a
    newline in resume.txt. Search must treat any run of whitespace as one space."""
    text = "Built a brand and a 64K+\ncommunity on a ~5% ad budget."
    m = server._find(text, "64k+  Community")
    assert m and text[m.start():m.end()] == "64K+\ncommunity"
    assert server._find(text, "64K+ followers") is None
