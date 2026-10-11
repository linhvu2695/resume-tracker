import datetime as dt

from lib import store


def test_slug_strips_vietnamese_diacritics_and_punctuation():
    s = store.make_slug({"company": "CÔNG TY TNHH ROTT VIỆT NAM",
                         "title": "[Tuyển Gấp] HR & Admin / Nhân Viên",
                         "posted": "2026-10"})
    assert s.startswith("2026-10-")
    assert all(c.isalnum() or c == "-" for c in s)      # safe as a path component
    assert "/" not in s and " " not in s


def test_d_stroke_becomes_d():
    assert store.slugify("Đà Nẵng") == "da-nang"       # NFD alone leaves U+0111


def test_needs_attention_follow_up_overdue():
    rec = {"status": "applied", "follow_up_on": "2026-01-01",
           "events": [{"on": "2026-01-01", "type": "applied"}]}
    assert "follow-up due" in store.needs_attention(rec, dt.date(2026, 1, 11))


def test_needs_attention_stale_open_application():
    rec = {"status": "screening", "events": [{"on": "2026-01-01", "type": "applied"}],
           "created_on": "2026-01-01"}
    why = store.needs_attention(rec, dt.date(2026, 1, 20))
    assert why and "no movement" in why


def test_closed_applications_never_nag():
    rec = {"status": "rejected", "follow_up_on": "2020-01-01", "created_on": "2020-01-01"}
    assert store.needs_attention(rec, dt.date(2026, 1, 1)) is None


def test_recent_activity_is_quiet():
    today = dt.date(2026, 1, 20)
    rec = {"status": "applied", "events": [{"on": "2026-01-19", "type": "note"}]}
    assert store.needs_attention(rec, today) is None


def test_dashboard_counts_and_sorts():
    recs = [
        {"slug": "a", "status": "applied", "created_on": "2026-01-01", "position": {}},
        {"slug": "b", "status": "offer", "created_on": "2026-01-18", "position": {}},
        {"slug": "c", "status": "draft", "created_on": "2026-01-19", "position": {}},
    ]
    d = store.dashboard(recs, dt.date(2026, 1, 20))
    assert d["total"] == 3 and d["by_status"]["applied"] == 1
    assert d["open"] == 2                                   # offer is not an open status
    assert [a["slug"] for a in d["attention"]] == ["a", "c"]  # stalest first


def test_marking_applied_schedules_a_follow_up():
    rec = store.new_application({"title": "t", "company": "c"})
    store.set_status(rec, "applied", dt.date(2026, 10, 11))
    assert rec["status"] == "applied" and rec["applied_on"] == "2026-10-11"
    assert rec["follow_up_on"] == "2026-10-18"              # FOLLOW_UP_AFTER_DAYS later
    assert rec["events"][-1] == {"on": "2026-10-11", "type": "status",
                                 "from": "draft", "to": "applied"}


def test_marking_applied_keeps_a_follow_up_the_user_set():
    rec = store.new_application({"title": "t", "company": "c"})
    rec["follow_up_on"] = "2026-10-13"
    store.set_status(rec, "applied", dt.date(2026, 10, 11))
    assert rec["follow_up_on"] == "2026-10-13"


def test_draft_with_closing_posting_says_so():
    rec = {"status": "draft", "created_on": "2026-10-10",
           "position": {"deadline": "2026-10-13"}}
    assert store.needs_attention(rec, dt.date(2026, 10, 11)) == "draft - posting closes in 2d"
    assert store.needs_attention(rec, dt.date(2026, 10, 13)) == "draft - posting closes today"
    assert store.needs_attention(rec, dt.date(2026, 10, 14)) == "draft - posting closed"


def test_same_posting_is_found_but_same_company_is_not():
    """Saving one posting twice is a mistake; applying to one company twice is normal."""
    recs = [
        {"slug": "a", "position": {"source": "vietnamworks", "source_id": "2112562", "company": "ROTT"}},
        {"slug": "b", "position": {"source": "vietnamworks", "source_id": "999", "company": "ROTT"}},
        {"slug": "c", "position": {"company": "ROTT"}},
    ]
    pos = {"source": "vietnamworks", "source_id": "2112562", "company": "ROTT"}
    assert store.same_posting(recs, pos) == ["a"]
    assert store.same_posting(recs, {"company": "ROTT"}) == []      # no id, no guess


def test_delete_moves_the_record_to_trash_and_keeps_its_files(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "APPS", tmp_path)
    d = store.save("2026-10-acme-sales", store.new_application({"title": "Sales", "company": "Acme"}))
    (d / "cv.pdf").write_bytes(b"%PDF-1 sent")
    store.save("2026-10-acme-ops", store.new_application({"title": "Ops", "company": "Acme"}))

    trashed = store.delete("2026-10-acme-sales")
    assert store.all_slugs() == ["2026-10-acme-ops"]            # gone from the tracker
    assert trashed.parent == tmp_path / "_trash"
    assert (trashed / "cv.pdf").read_bytes() == b"%PDF-1 sent"  # but recoverable
    assert store.delete("2026-10-acme-sales") is None           # already gone


def test_hearing_back_clears_the_applied_follow_up():
    """The follow-up set on 'applied' means "chase them if they don't reply". Once the
    application moves on (screening, interview, ...), that reminder is stale."""
    rec = store.new_application({"title": "t", "company": "c"})
    store.set_status(rec, "applied", dt.date(2026, 10, 1))
    assert rec["follow_up_on"] == "2026-10-08"
    store.set_status(rec, "screening", dt.date(2026, 10, 5))
    assert rec["follow_up_on"] is None
    assert store.needs_attention(rec, dt.date(2026, 10, 9)) is None
