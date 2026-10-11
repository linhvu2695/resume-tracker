"""Import a job from any page that carries a schema.org JobPosting (JSON-LD).

That block exists for Google for Jobs, so job boards keep it complete and stable: TopCV
ships title, company, address, salary range, deadline and the full description HTML in it
(checked on live pages 2026-10-11). One parser therefore covers TopCV and any other board
that follows the standard. VietnamWorks does not, and keeps its own importer.

Returns the same position shape as lib/vietnamworks.parse, JD included, or None when the
page has no JobPosting.
"""
import html
import json
import re
import unicodedata
from urllib.parse import urlparse

_LD = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.S | re.I)


def _nfc(v):
    if isinstance(v, str):
        return unicodedata.normalize("NFC", v)
    if isinstance(v, list):
        return [_nfc(x) for x in v]
    if isinstance(v, dict):
        return {k: _nfc(x) for k, x in v.items()}
    return v


def _postings(v):
    """Every JobPosting object, wherever it sits: top level, a list, or an @graph."""
    if isinstance(v, list):
        for x in v:
            yield from _postings(x)
    elif isinstance(v, dict):
        t = v.get("@type")
        if t == "JobPosting" or (isinstance(t, list) and "JobPosting" in t):
            yield v
        for x in v.get("@graph") or []:
            yield from _postings(x)


def find(doc):
    for block in _LD.findall(doc or ""):
        try:
            data = json.loads(block, strict=False)
        except ValueError:
            continue                       # one broken block must not hide the others
        for p in _postings(data):
            return _nfc(p)
    return None


def _first(v):
    return v[0] if isinstance(v, list) and v else v


_SUB_PROVINCE = re.compile(r"^(quận|huyện|phường|xã|thị xã|thị trấn|district|ward)\b", re.I)


def _location(jl):
    addr = (_first(jl) or {}).get("address") if isinstance(_first(jl), dict) else None
    addr = _first(addr)
    if isinstance(addr, str):
        return addr or None
    if isinstance(addr, dict):
        region, locality = addr.get("addressRegion"), addr.get("addressLocality")
        # CareerViet puts the district in addressRegion and the province in addressLocality;
        # TopCV does the reverse. Prefer whichever is the province.
        if region and locality and _SUB_PROVINCE.match(region.strip()) and not _SUB_PROVINCE.match(locality.strip()):
            return locality.strip()
        return (region or locality or "").strip() or None
    return None


def _salary(bs):
    bs = _first(bs)
    if not isinstance(bs, dict):
        return None
    cur = bs.get("currency") or None
    val = bs.get("value")
    lo = hi = None
    if isinstance(val, dict):
        lo, hi = val.get("minValue"), val.get("maxValue")
        unit = (val.get("unitText") or "").lower()
        if lo is None and hi is None:
            v = val.get("value")
            if isinstance(v, (int, float)):
                lo = v
            elif v:                         # "Thoả thuận", "Competitive", ...
                return {"negotiable": True, "raw": str(v)}
    elif isinstance(val, (int, float)):
        lo, unit = val, ""
    else:
        return None
    if lo is None and hi is None:
        return None
    nums = [int(x) for x in (lo, hi) if isinstance(x, (int, float))]
    raw = " – ".join(f"{n:,}" for n in nums) + (f" {cur}" if cur else "") + (f"/{unit}" if unit else "")
    return {"min": int(lo) if lo is not None else None, "max": int(hi) if hi is not None else None,
            "currency": cur, "open_ended": hi is None, "negotiable": False, "raw": raw}


def jd_markdown(desc):
    """Description HTML -> the JD markdown the app renders: '## ' headings, '- ' bullets."""
    s = desc or ""
    if "<" not in s and "&lt;" in s:       # some boards ship the HTML entity-escaped
        s = html.unescape(s)
    s = re.sub(r"(?is)<(script|style).*?</\1>", "", s)
    s = re.sub(r"(?is)<h[1-6][^>]*>(.*?)</h[1-6]>", lambda m: "\n## " + re.sub(r"<[^>]+>", "", m.group(1)) + "\n", s)
    s = re.sub(r"(?i)<li[^>]*>", "\n- ", s)
    s = re.sub(r"(?i)<br\s*/?>|</(p|div|li|ul|ol|tr)>", "\n", s)
    s = html.unescape(re.sub(r"<[^>]+>", "", s))
    out = []
    for ln in s.split("\n"):
        ln = re.sub(r"[ \t\xa0]+", " ", ln).strip()
        if not ln or ln == "-":
            continue
        if ln.startswith("## ") and out:
            out.append("")
        out.append(ln)
    return "\n".join(out) or None


def _source(url):
    host = (urlparse(url).hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    return host.split(".")[0] or None


def parse(doc, url=""):
    p = find(doc)
    if p is None:
        return None
    org = p.get("hiringOrganization")
    company = org.get("name") if isinstance(org, dict) else org
    jid = re.search(r"(\d{5,})(?:\.html?)?/?$", urlparse(url).path or "")
    jd = jd_markdown(p.get("description"))
    skills = p.get("skills")
    if isinstance(skills, list):
        skills = ", ".join(str(x) for x in skills)
    if skills:
        jd = (jd + "\n\n" if jd else "") + f"## Skills\n{skills}"
    return {
        "source": _source(url), "url": url.split("?")[0] or None,
        "source_id": jid.group(1) if jid else None,
        "title": (p.get("title") or "").strip() or None,
        "company": (company or "").strip() or None,
        "posted": (p.get("datePosted") or "")[:7] or None,
        "salary": _salary(p.get("baseSalary")),
        "location": _location(p.get("jobLocation")),
        "jd": jd,
        "deadline": (p.get("validThrough") or "")[:10] or None,
        "contact_email": None,
    }
