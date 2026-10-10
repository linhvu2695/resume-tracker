"""The importer is a regex over og: meta tags, so it is parsed offline from captured
fixtures. The one thing that is NOT offline-testable is Unicode form: VietnamWorks
serves decomposed Vietnamese, and an NFC fixture would hide the bug that caused.
So the decomposed case is tested explicitly."""
import unicodedata

from lib.vietnamworks import parse, parse_salary

DESC = ("{co} tuyển dụng vị trí {mid}, mức lương {sal}, "
        "môi trường chuyên nghiệp. VietnamWorks!")


def page(title, co, mid, sal, month="10", year="2026"):
    return ('<meta property="og:title" content="Tuyển {t} tại {c} T{m}/{y}">'
            '<meta property="og:description" content="{d}">').format(
        t=title, c=co, m=month, y=year, d=DESC.format(co=co, mid=mid, sal=sal))


def test_full_record():
    p = parse(page("Nhân Viên Marketing", "CÔNG TY ROTT",
                   "Nhân Viên Marketing Hồ Chí Minh", "$15000000 - $30000000"),
              "https://www.vietnamworks.com/x-2112562-jv")
    assert p["title"] == "Nhân Viên Marketing"
    assert p["company"] == "CÔNG TY ROTT"
    assert p["location"] == "Hồ Chí Minh"
    assert p["source_id"] == "2112562"
    assert p["posted"] == "2026-10"
    assert p["salary"]["min"] == 15_000_000 and p["salary"]["currency"] == "VND"


def test_decomposed_unicode_still_parses():
    """The live site serves NFD. Literal patterns miss unless we normalize."""
    html = unicodedata.normalize("NFD", page(
        "Thực Tập Sinh", "Influx", "Thực Tập Sinh Hồ Chí Minh", "$100 - $150"))
    assert html != unicodedata.normalize("NFC", html)       # fixture really is decomposed
    p = parse(html, "https://www.vietnamworks.com/y-2015774-jv")
    assert p["location"] == "Hồ Chí Minh"
    assert p["salary"]["currency"] == "USD"                 # $100 is really USD


def test_salary_shapes():
    assert parse_salary("$15000000 - $30000000")["currency"] == "VND"
    assert parse_salary("$100 - $150")["currency"] == "USD"   # the "$" alone is not a signal
    assert parse_salary("Từ $12000000")["open_ended"] is True
    assert parse_salary("Lương thương lượng")["negotiable"] is True
    assert parse_salary("")["negotiable"] is True


def test_missing_meta_does_not_explode():
    p = parse("<html><head></head></html>", "https://x/a-1-jv")
    assert p["source_id"] == "1" and "title" not in p


# ---- the job body, embedded as Next.js flight data -------------------------------

def flight_page(rows, splits=(57,)):
    """Wrap raw flight text the way the live page does: chunked across several
    self.__next_f.push([1,"..."]) script tags, each a JSON-escaped string."""
    import json
    cuts = [0, *splits, len(rows)]
    return "".join('<script>self.__next_f.push([1,%s])</script>' % json.dumps(rows[a:b])
                   for a, b in zip(cuts, cuts[1:]))


def job_rows(desc="<p>• Viết nội dung</p><p>• Quản lý <b>fanpage</b></p>",
             req="<p>• Tiếng Anh tốt</p>", form="NFC"):
    import json
    desc, req = unicodedata.normalize(form, desc), unicodedata.normalize(form, req)
    job = {"jobId": 2112562, "jobTitle": "Nhân Viên Marketing", "jobDescription": desc,
           "jobRequirement": "$1f", "benefits": "$20", "expiredOn": "2026-10-28T23:59:59+07:00",
           "emailAddress": "hr@rott.example"}
    req_bytes = len(req.encode("utf-8"))
    # A T-row is "<id>:T<hex byte length>,<text>" with NO newline after it -- the next
    # row starts immediately. Its length counts UTF-8 bytes, not characters.
    benefits = unicodedata.normalize(
        form, '20:[{"benefitNameVI":"Thưởng","benefitValue":"Thưởng KPI<br/>Thưởng Tết"}]\n')
    return ('0:["$","html",null,{}]\n'
            '5:["$","div",null,{"children":["$","section",null,{"job":%s}]}]\n'
            '1f:T%x,%s%s'
            % (json.dumps(job, ensure_ascii=False), req_bytes, req, benefits))


def test_job_description_comes_from_flight_data():
    p = parse(flight_page(job_rows()), "https://www.vietnamworks.com/x-2112562-jv")
    assert p["jd"] == ("## Description\n• Viết nội dung\n• Quản lý fanpage\n\n"
                       "## Requirements\n• Tiếng Anh tốt\n\n"
                       "## Benefits\n- Thưởng: Thưởng KPI\n  Thưởng Tết")
    assert p["deadline"] == "2026-10-28"
    assert p["contact_email"] == "hr@rott.example"


def test_flight_text_row_length_is_bytes_and_split_across_pushes():
    """Multi-byte Vietnamese makes byte and character lengths differ; reading the
    T-row by characters would swallow the start of the next row."""
    req = "<p>" + "Yêu cầu kinh nghiệm " * 20 + "</p>"
    rows = job_rows(req=req)
    start = rows.index("1f:T")
    p = parse(flight_page(rows, splits=(start + 30,)), "https://x/a-1-jv")   # split mid-row
    assert "Yêu cầu kinh nghiệm" in p["jd"]
    assert "## Benefits\n- Thưởng" in p["jd"]


def test_decomposed_flight_text_is_normalized():
    rows = job_rows(form="NFD")
    assert rows != unicodedata.normalize("NFC", rows)      # fixture really is decomposed
    p = parse(flight_page(rows), "https://x/a-1-jv")
    assert "Viết nội dung" in p["jd"]                      # NFC literal matches


def test_page_without_flight_data_has_no_jd():
    p = parse("<html><head></head></html>", "https://x/a-1-jv")
    assert p.get("jd") is None and p.get("deadline") is None
