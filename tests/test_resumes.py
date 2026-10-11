"""Resume versions and diffs. A "version" is a distinct PDF (by content hash), however many
applications sent it; diffs run on extracted text, so they are tested on text directly."""
import pytest

from lib import resumes, store


# ---- logical lines: diff what was written, not how the PDF wrapped it -------------

WRAPPED = ("PROFESSIONAL PROFILE\n"
           "Brand and content strategist with 7+ years across social commerce and brand building\n"
           "and marketing education.\n"
           "• Created a zero-budget TikTok series that reached 4.3M views and landed 4 brand\n"
           "partnerships in 30 days\n"
           "• Built a fashion brand\n"
           "SKILLS")


def test_logical_lines_rejoin_wrapped_lines_but_keep_bullets_and_headings():
    assert resumes.logical_lines(WRAPPED) == [
        "PROFESSIONAL PROFILE",
        "Brand and content strategist with 7+ years across social commerce and brand building and marketing education.",
        "• Created a zero-budget TikTok series that reached 4.3M views and landed 4 brand partnerships in 30 days",
        "• Built a fashion brand",
        "SKILLS",
    ]


def test_rewrapping_alone_is_not_a_change():
    """Adding one word early in a paragraph re-wraps every line after it in the PDF."""
    a = "• Created a zero-budget TikTok series that reached 4.3M views and landed 4 brand\npartnerships in 30 days"
    b = "• Created a zero-budget TikTok series that reached 4.3M views and landed four\nbrand partnerships in 30 days"
    d = resumes.diff(a, b)
    assert d["changed"] == 1 and d["added"] == 0 and d["removed"] == 0     # one line, one word


# ---- diff ---------------------------------------------------------------------------

BASE = "SKILLS\n• Content strategy\n• TikTok\n• Canva"


def test_identical_text_has_no_changes():
    d = resumes.diff(BASE, BASE)
    assert (d["added"], d["removed"], d["changed"]) == (0, 0, 0)
    assert all(r["tag"] == "equal" for r in d["rows"])


def test_added_and_removed_bullets():
    d = resumes.diff(BASE, "SKILLS\n• Content strategy\n• TikTok\n• Meta Ads Manager")
    assert d["changed"] + d["added"] + d["removed"] >= 1
    tailored = resumes.diff(BASE, BASE + "\n• Shopee Ads")
    assert tailored["added"] == 1 and tailored["removed"] == 0
    assert tailored["rows"][-1] == {"tag": "insert", "a": None, "b": "• Shopee Ads", "a_marks": [], "b_marks": []}


def test_a_changed_word_is_marked_inside_the_line():
    d = resumes.diff("• Grew revenue to 2B VND", "• Grew revenue to 3B VND")
    row = next(r for r in d["rows"] if r["tag"] == "replace")
    assert row["a"][slice(*row["a_marks"][0])] == "2B"
    assert row["b"][slice(*row["b_marks"][0])] == "3B"


def test_unrelated_lines_are_not_paired_as_a_change():
    """A removed bullet and an unrelated new one are a delete and an insert, not one
    'changed' line with every word marked."""
    d = resumes.diff("• Managed B2B accounts for Shell", "• Coached students to 400K followers")
    assert (d["added"], d["removed"], d["changed"]) == (1, 1, 0)


# ---- versions ---------------------------------------------------------------------

@pytest.fixture
def apps(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "APPS", tmp_path)

    def add(slug, pdf_bytes, text, status="applied", title="Marketing", file="Linh_CV.pdf"):
        rec = store.new_application({"title": title, "company": slug.upper()})
        rec["status"], rec["applied_on"] = status, "2026-10-0" + str(len(store.all_slugs()) + 1)
        rec["resume"] = {"file": file, "pages": 1, "text_ok": True}
        d = store.save(slug, rec)
        (d / file).write_bytes(pdf_bytes)
        (d / "resume.txt").write_text(text, encoding="utf-8")
    return add


def test_the_same_pdf_sent_twice_is_one_version(apps):
    apps("acme", b"%PDF-1 same", "A")
    apps("rott", b"%PDF-1 same", "A", status="interview")
    apps("zeta", b"%PDF-1 other", "B")
    vs = resumes.versions(store.load_all())
    assert len(vs) == 2
    shared = next(v for v in vs if len(v["apps"]) == 2)
    assert sorted(a["slug"] for a in shared["apps"]) == ["acme", "rott"]
    assert shared["label"] == "Linh_CV"                 # default label: the filename
    assert shared["best"] == "interview"                # furthest any application got


def test_a_library_base_resume_is_a_version_with_no_applications(apps):
    apps("acme", b"%PDF-1 tailored", "A tailored")
    sha = resumes.add_to_library(b"%PDF-1 master", "Master CV.pdf", "A master")
    resumes.set_meta(sha, base=True, label="Master")
    vs = resumes.versions(store.load_all())
    base = vs[0]
    assert base["sha"] == sha and base["is_base"] and base["apps"] == [] and base["label"] == "Master"
    assert resumes.text_for(sha, store.load_all()) == "A master"
    assert resumes.base_sha() == sha


def test_only_one_base(apps):
    a = resumes.add_to_library(b"%PDF-1 a", "a.pdf", "a")
    b = resumes.add_to_library(b"%PDF-1 b", "b.pdf", "b")
    resumes.set_meta(a, base=True)
    resumes.set_meta(b, base=True)
    assert resumes.base_sha() == b
    assert [v["sha"] for v in resumes.versions([]) if v["is_base"]] == [b]


def test_sha_of_an_application_resume(apps):
    apps("acme", b"%PDF-1 x", "x")
    assert resumes.sha_of_record(store.load("acme")) == resumes.sha_bytes(b"%PDF-1 x")
