import server


def test_phrase_matches_across_a_line_wrap():
    """A resume wraps wherever the layout says, so "78K+ community" can be split by a
    newline in resume.txt. Search must treat any run of whitespace as one space."""
    text = "Built a brand and a 78K+\ncommunity on a ~5% ad budget."
    m = server._find(text, "78k+  Community")
    assert m and text[m.start():m.end()] == "78K+\ncommunity"
    assert server._find(text, "78K+ followers") is None
