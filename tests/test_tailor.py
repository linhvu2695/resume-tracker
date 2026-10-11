"""AI tailoring guardrails, offline: what leaves the machine (redaction) and what comes back
(the honesty check). The AI step itself runs in Claude Code and is not tested here."""
import json

import pytest

from lib import store, tailor

BASE = """TRAN MINH ANH
Content & Social Marketing Lead · Data-driven Content Strategy · AI
Ho Chi Minh City, Vietnam · +84 912-345-678 · minhanh.tran@example.com
Portfolio: minhanh-portfolio.vercel.app
PROFESSIONAL EXPERIENCE
Content Creator & Strategist - @minhanh.creates (TikTok, personal brand) Feb 2026 – Present
• Produced a 60-video series reaching 2.8M total views with a 6.2% engagement rate.
• Secured 3 brand partnerships within 45 days: Skinova, Brewlab, Paylo, Sunny Studio.
• Grew Lunavibe to 3B VND peak annual revenue and a 64K+ community."""


# ---- redaction: what may be sent ----------------------------------------------------

def test_redaction_removes_every_contact_detail():
    red, mapping = tailor.redact(BASE)
    for secret in ("TRAN MINH ANH", "912-345-678", "minhanh.tran@example.com",
                   "minhanh-portfolio.vercel.app", "@minhanh.creates"):
        assert secret not in red, secret
    assert red.splitlines()[0] == "[NAME]"
    assert "[EMAIL_1]" in red and "[PHONE_1]" in red and "[LINK_1]" in red and "[HANDLE_1]" in red
    # the work itself is untouched
    assert "2.8M total views" in red and "Ho Chi Minh City, Vietnam" in red


def test_redaction_round_trips():
    red, mapping = tailor.redact(BASE)
    assert tailor.restore(red, mapping) == BASE


def test_money_and_metrics_are_not_mistaken_for_phone_numbers():
    red, _ = tailor.redact("[x]\n• Revenue 15000000 VND, 2016 – 2020, 0.5% churn, 12,000 reviews")
    assert "15000000" in red and "12,000" in red and "PHONE" not in red


def test_a_name_repeated_in_the_body_is_redacted_too():
    red, _ = tailor.redact("JANE DOE\n• Jane Doe led the team")
    assert "Jane Doe" not in red and red.count("[NAME]") == 2


# ---- the honesty check: what comes back ---------------------------------------------

def test_invented_numbers_are_flagged():
    red, _ = tailor.redact(BASE)
    problems = tailor.unknown_facts(red, "• Produced a 60-video series reaching 2.8M views and grew sales 40%.")
    assert [p["fact"] for p in problems] == ["40%"]


def test_reworded_lines_with_the_same_facts_pass():
    red, _ = tailor.redact(BASE)
    assert tailor.unknown_facts(red, "• 2.8M views and 6.2% engagement across a 60-video series") == []
    assert tailor.unknown_facts(red, "• Doanh thu đỉnh 3B VND, cộng đồng 64K+") == []


def test_unknown_names_are_flagged_as_a_warning():
    red, _ = tailor.redact(BASE)
    problems = tailor.unknown_facts(red, "• Ran campaigns for Unilever and Skinova on TikTok.")
    assert [(p["fact"], p["level"]) for p in problems] == [("Unilever", "warn")]


# ---- result validation ---------------------------------------------------------------

def good_result(red):
    return {"summary": "Leads with content marketing.",
            "gaps": [{"requirement": "Kinh nghiệm Content Marketing", "strength": "strong",
                      "evidence": ["• Produced a 60-video series reaching 2.8M total views with a 6.2% engagement rate."],
                      "advice": "Lead with this."}],
            "tailored": red.replace("Content & Social Marketing Lead", "Marketing Executive"),
            "notes": [{"line": "Marketing Executive · Data-driven Content Strategy · AI", "requirement": "Title", "why": "Match the role"}],
            "tailored_vi": red.replace("PROFESSIONAL EXPERIENCE", "KINH NGHIỆM LÀM VIỆC")}


def test_a_good_result_has_no_errors():
    red, _ = tailor.redact(BASE)
    assert [p for p in tailor.validate(good_result(red), red) if p["level"] == "error"] == []


def test_validation_catches_schema_errors_lost_placeholders_and_invented_facts():
    red, _ = tailor.redact(BASE)
    r = good_result(red)
    r["gaps"][0]["strength"] = "excellent"
    r["tailored"] = r["tailored"].replace("[EMAIL_1]", "") + "\n• Managed a 50-person team."
    msgs = [p["message"] for p in tailor.validate(r, red) if p["level"] == "error"]
    assert any("strength" in m for m in msgs)
    assert any("[EMAIL_1]" in m for m in msgs)
    assert any("50" in m for m in msgs)


# ---- prepare / load, on disk ----------------------------------------------------------

@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "APPS", tmp_path)
    from lib import resumes
    base = resumes.add_to_library(b"%PDF-1 base", "base.pdf", BASE)
    resumes.set_meta(base, base=True)
    store.save("acme", store.new_application({"title": "Marketing Executive", "company": "Acme"}))
    (tmp_path / "acme" / "jd.md").write_text("## Mô tả công việc\n- Viết nội dung", encoding="utf-8")
    return tmp_path / "acme"


def test_prepare_writes_only_redacted_inputs_and_keeps_the_mapping_local(app):
    out = tailor.prepare("acme")
    sent = (app / "tailor" / "input" / "base.md").read_text(encoding="utf-8")
    assert "minhanh.tran@example.com" not in sent and "[EMAIL_1]" in sent
    assert (app / "tailor" / "input" / "jd.md").read_text(encoding="utf-8").startswith("## Mô tả")
    assert json.loads((app / "tailor" / "redaction.json").read_text())["[EMAIL_1]"] == "minhanh.tran@example.com"
    assert out["result"] == str(app / "tailor" / "result.json")


def test_prepare_needs_a_base_resume_and_a_jd(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "APPS", tmp_path)
    store.save("x", store.new_application({"title": "t", "company": "c"}))
    with pytest.raises(tailor.NotReady, match="base resume"):
        tailor.prepare("x")


def test_load_restores_contact_details_for_display(app):
    tailor.prepare("acme")
    red = (app / "tailor" / "input" / "base.md").read_text(encoding="utf-8")
    (app / "tailor" / "result.json").write_text(json.dumps(good_result(red), ensure_ascii=False), encoding="utf-8")
    view = tailor.load("acme")
    assert "minhanh.tran@example.com" in view["tailored"] and "[EMAIL_1]" not in view["tailored"]
    assert "minhanh.tran@example.com" in view["base"]
    assert [p for p in view["problems"] if p["level"] == "error"] == []
    assert view["diff"]["changed"] >= 1


def test_a_number_must_match_with_its_unit():
    """'30 days' in the base does not make '30%' a real result; '2.8M' is not '2.8%'."""
    red, _ = tailor.redact(BASE)
    facts = [p["fact"] for p in tailor.unknown_facts(red + "\n• within 30 days", "• reached 30% more students and 2.8% growth")]
    assert facts == ["30%", "2.8%"]
    # unit-less mentions still match any unit: '60' from '60-video', '3B' written as '3B'
    assert tailor.unknown_facts(red + "\n• 1.04M views", "• 60 videos, 3B VND, 64K+ community, 1.04M views") == []
