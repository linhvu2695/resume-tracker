"""Import from any page carrying a schema.org JobPosting (TopCV and others), offline.
Fixtures mirror the shape of live TopCV pages checked on 2026-10-11."""
import json
import unicodedata

import pytest

from lib import importer, jobposting

URL = "https://www.topcv.vn/viec-lam/affiliate-marketing-executive/2326482.html"

POSTING = {
    "@context": "https://schema.org", "@type": "JobPosting",
    "title": "Affiliate Marketing Executive",
    "description": ('<h2>Mô tả công việc</h2>\n<ul><li data-list-item-id="e1"><strong>Vận hành Affiliate:</strong> '
                    'tìm kiếm Publisher/KOC.</li><li>Báo cáo GMV &amp; ROAS.</li></ul>'
                    '<h2>Yêu cầu ứng viên</h2><p>Tối thiểu 1 năm kinh nghiệm.</p>'),
    "datePosted": "2026-10-09", "validThrough": "2026-11-08T23:59:59+07:00",
    "hiringOrganization": {"@type": "Organization", "name": "CÔNG TY CỔ PHẦN THƯƠNG MẠI CALEN"},
    "jobLocation": {"@type": "Place", "address": {"@type": "PostalAddress", "streetAddress": "350C Hoàng Văn Thụ",
                                                  "addressLocality": "Phường Tân Sơn Nhất", "addressRegion": "Hồ Chí Minh"}},
    "baseSalary": {"@type": "MonetaryAmount", "currency": "VND",
                   "value": {"@type": "QuantitativeValue", "unitText": "MONTH", "minValue": 12000000, "maxValue": 15000000}},
    "identifier": {"@type": "PropertyValue", "name": "CALEN", "value": 106513},      # the COMPANY id, not the job's
}


def page(*blocks, body=""):
    scripts = "".join(f'<script type="application/ld+json">{b if isinstance(b, str) else json.dumps(b, ensure_ascii=False)}</script>'
                      for b in blocks)
    return f"<html><head>{scripts}</head><body>{body}</body></html>"


def test_full_record_from_topcv():
    p = jobposting.parse(page(POSTING), URL)
    assert p["title"] == "Affiliate Marketing Executive"
    assert p["company"] == "CÔNG TY CỔ PHẦN THƯƠNG MẠI CALEN"
    assert p["location"] == "Hồ Chí Minh"
    assert p["salary"]["min"] == 12_000_000 and p["salary"]["max"] == 15_000_000
    assert p["salary"]["currency"] == "VND" and p["salary"]["negotiable"] is False
    assert p["deadline"] == "2026-11-08" and p["posted"] == "2026-10"
    assert p["source"] == "topcv"
    assert p["source_id"] == "2326482"           # from the URL; identifier.value is the company
    assert p["url"] == URL


def test_description_becomes_the_jd_markdown():
    p = jobposting.parse(page(POSTING), URL)
    assert p["jd"] == ("## Mô tả công việc\n- Vận hành Affiliate: tìm kiếm Publisher/KOC.\n- Báo cáo GMV & ROAS.\n\n"
                       "## Yêu cầu ứng viên\nTối thiểu 1 năm kinh nghiệm.")


def test_negotiable_salary():
    posting = dict(POSTING, baseSalary={"@type": "MonetaryAmount", "currency": "VND",
                                        "value": {"@type": "QuantitativeValue", "unitText": "MONTH", "value": "Thoả thuận"}})
    s = jobposting.parse(page(posting), URL)["salary"]
    assert s["negotiable"] is True and s["raw"] == "Thoả thuận"


def test_skills_are_appended_to_the_jd():
    p = jobposting.parse(page(dict(POSTING, skills="Brand Marketing, Content Strategy")), URL)
    assert p["jd"].endswith("## Skills\nBrand Marketing, Content Strategy")


def test_other_ld_json_blocks_and_shapes_are_tolerated():
    """Sites wrap JobPosting in a list or an @graph, put a BreadcrumbList first,
    or ship a broken block; none of that should stop the import."""
    crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": []}
    for doc in (page(crumbs, POSTING), page("{not json", [POSTING]),
                page({"@context": "https://schema.org", "@graph": [crumbs, POSTING]})):
        assert jobposting.parse(doc, URL)["title"] == "Affiliate Marketing Executive"


def test_location_list_and_escaped_description():
    posting = dict(POSTING, jobLocation=[{"@type": "Place", "address": {"addressRegion": "Hà Nội"}}],
                   description="&lt;h2&gt;Mô tả&lt;/h2&gt;&lt;p&gt;Viết nội dung&lt;/p&gt;")
    p = jobposting.parse(page(posting), URL)
    assert p["location"] == "Hà Nội"
    assert p["jd"] == "## Mô tả\nViết nội dung"


def test_decomposed_unicode_is_normalized():
    doc = unicodedata.normalize("NFD", page(POSTING))
    assert jobposting.parse(doc, URL)["location"] == "Hồ Chí Minh"


def test_a_search_results_page_is_refused_with_a_hint():
    links = "".join(f'<a href="https://www.topcv.vn/viec-lam/job-{i}/23{i:05d}.html">job</a>' for i in range(5))
    with pytest.raises(importer.NotAJobPage, match="list of jobs"):
        importer.parse_page("https://www.topcv.vn/tim-viec-lam-marketing-tai-ho-chi-minh-l2cr92cb99", page(body=links))


def test_a_page_without_a_job_posting_is_refused():
    with pytest.raises(importer.NotAJobPage, match="no job posting"):
        importer.parse_page("https://example.com/about", page(body="<p>hello</p>"))


def test_vietnamworks_still_uses_its_own_importer():
    doc = ('<meta property="og:title" content="Tuyển Nhân Viên Marketing tại CÔNG TY ROTT T10/2026">'
           '<meta property="og:description" content="CÔNG TY ROTT tuyển dụng vị trí Nhân Viên Marketing Hồ Chí Minh, '
           'mức lương $15000000 - $30000000, môi trường chuyên nghiệp.">')
    p = importer.parse_page("https://www.vietnamworks.com/x-2112562-jv", doc)
    assert p["source"] == "vietnamworks" and p["company"] == "CÔNG TY ROTT"


def test_district_in_region_falls_back_to_the_province():
    """CareerViet puts the district in addressRegion and the province in addressLocality --
    the reverse of TopCV. Show the province either way."""
    posting = dict(POSTING, jobLocation={"@type": "Place", "address": {
        "addressRegion": "Huyện Long Thành", "addressLocality": "Đồng Nai", "addressCountry": "VN"}})
    assert jobposting.parse(page(posting), URL)["location"] == "Đồng Nai"
    posting = dict(POSTING, jobLocation={"address": {"addressRegion": "Quận 7", "addressLocality": "Hồ Chí Minh"}})
    assert jobposting.parse(page(posting), URL)["location"] == "Hồ Chí Minh"
    # TopCV's shape (province in region, ward in locality) is unchanged
    assert jobposting.parse(page(POSTING), URL)["location"] == "Hồ Chí Minh"


def test_a_single_job_page_without_data_is_not_called_a_search_page():
    """A job page lists 'related jobs' too. If the URL itself is one job, say there is no
    job data, not that the user pasted a search page."""
    links = "".join(f'<a href="https://timviec365.vn/job-{i}-p20{i:05d}.html">job</a>' for i in range(8))
    with pytest.raises(importer.NotAJobPage, match="no job posting"):
        importer.parse_page("https://timviec365.vn/tuyen-dung-livestream-p2063482.html", page(body=links))
