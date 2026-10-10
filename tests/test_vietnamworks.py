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
