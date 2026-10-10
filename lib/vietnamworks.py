"""Import a job posting from a VietnamWorks URL.

A VietnamWorks job page is a Next.js app: the HTML that `urlopen` returns carries
~100 characters of *visible* body text. Two things in it are still parseable:

  * The <meta og:*> tags, which follow one stable template and give the header:
        og:title       Tuyen {TITLE} tai {COMPANY} T{MM}/{YYYY}
        og:description {COMPANY} tuyen dung vi tri {TITLE} {LOCATION}, muc luong {SALARY}, ...
  * The React "flight" payload in `self.__next_f.push([1, "..."])` script tags, which
    holds the full job object -- description, requirements, benefits, deadline. Long
    strings in it are references ("$29") to separate rows, resolved by `_flight_rows`.

So one fetch imports the whole posting, JD included -- no headless browser.
Validated against 9 unrelated live listings (see tests/test_vietnamworks.py).
"""
import html
import json
import unicodedata
import re
import sys
import urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36")

_TITLE_RX = re.compile(r"^Tuyển\s+(?P<title>.+?)\s+tại\s+(?P<co>.+?)\s+T(?P<m>\d{1,2})/(?P<y>\d{4})\s*$")
_DESC_RX = re.compile(r"^(?P<co>.+?)\s+tuyển dụng vị trí\s+(?P<mid>.+?),"
                      r"\s*mức lương\s+(?P<sal>.+?),\s*môi trường")


def _nfc(s):
    """VietnamWorks serves Vietnamese in a decomposed form (e + U+0302 + U+0309
    rather than a precomposed U+1EC3). Literal patterns like "tuy\u1ec3n d\u1ee5ng"
    silently miss against it, so every string crossing this boundary is normalized."""
    return unicodedata.normalize("NFC", s)


def _meta(doc, key):
    m = re.search(r'<meta\s+(?:property|name)="%s"\s+content="([^"]*)"' % re.escape(key), doc)
    return _nfc(html.unescape(m.group(1)).strip()) if m else ""


def parse_salary(raw):
    """VietnamWorks prints a '$' in front of VND amounts. The symbol is not
    trustworthy -- infer the currency from magnitude instead.
    Seen in the wild: '$15000000 - $30000000', '$100 - $150', 'Từ $12000000',
    'Lương thương lượng'."""
    raw = (raw or "").strip()
    if not raw or "thương lượng" in raw.lower():
        return {"negotiable": True, "raw": raw}
    nums = [int(n.replace(".", "").replace(",", "")) for n in re.findall(r"[\d.,]{3,}", raw)]
    if not nums:
        return {"negotiable": True, "raw": raw}
    return {
        "min": nums[0],
        "max": nums[1] if len(nums) > 1 else None,
        "currency": "VND" if max(nums) >= 1_000_000 else "USD",
        "open_ended": raw.startswith("Từ"),
        "negotiable": False,
        "raw": raw,
    }


def parse(doc, url=""):
    """Pull the position fields out of a fetched VietnamWorks page."""
    title_meta, desc = _meta(doc, "og:title"), _meta(doc, "og:description")
    out = {"source": "vietnamworks", "url": url.split("?")[0] or None}

    sid = re.search(r"-(\d+)-jv", url or "")
    out["source_id"] = sid.group(1) if sid else None

    t = _TITLE_RX.match(title_meta)
    if t:
        out["title"] = t.group("title").strip()
        out["company"] = t.group("co").strip()
        out["posted"] = "%s-%02d" % (t.group("y"), int(t.group("m")))

    d = _DESC_RX.match(desc)
    if d:
        out.setdefault("company", d.group("co").strip())
        out["salary"] = parse_salary(d.group("sal"))
        mid = d.group("mid").strip()
        title = out.get("title")
        # og:description = "{TITLE} {LOCATION}" with no delimiter; subtract the
        # title (which og:title gives us cleanly) to leave the location.
        if title and mid.startswith(title):
            out["location"] = mid[len(title):].strip(" ,") or None
        else:
            out.setdefault("title", mid)

    job = _job(doc)
    out["jd"] = _jd_markdown(job) if job else None
    out["deadline"] = (job.get("expiredOn") or "")[:10] or None if job else None
    out["contact_email"] = job.get("emailAddress") or None if job else None

    body = re.sub(r"<script.*?</script>|<style.*?</style>", "", doc, flags=re.S)
    out["_server_rendered_chars"] = len(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body)).strip())
    return out


# ---- the job object, from the Next.js flight payload ----------------------------

_PUSH_RX = re.compile(r'self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)')
_ROW_RX = re.compile(rb"([0-9a-f]+):")
_TEXT_RX = re.compile(rb"T([0-9a-f]+),")
_REF_RX = re.compile(r"\$([0-9a-f]+)")


def _flight_rows(doc):
    """{row id: value}. Pushes are chunks of one stream and split rows anywhere, so
    join them first. A row is "<id>:<json>\\n", or a text row "<id>:T<hex len>,<text>"
    whose length is in UTF-8 *bytes* and which has no newline after it."""
    try:
        buf = "".join(json.loads(p) for p in _PUSH_RX.findall(doc)).encode("utf-8")
    except ValueError:
        return {}
    rows, i = {}, 0
    while i < len(buf):
        m = _ROW_RX.match(buf, i)
        if not m:                                  # a row type we do not parse: skip it
            j = buf.find(b"\n", i)
            i = len(buf) if j < 0 else j + 1
            continue
        rid, i = m.group(1).decode(), m.end()
        t = _TEXT_RX.match(buf, i)
        if t:
            n = int(t.group(1), 16)
            rows[rid] = buf[t.end():t.end() + n].decode("utf-8", "replace")
            i = t.end() + n
            continue
        j = buf.find(b"\n", i)
        j = len(buf) if j < 0 else j
        try:
            rows[rid] = json.loads(buf[i:j])
        except ValueError:
            pass
        i = j + 1
    return rows


def _find_job(v):
    if isinstance(v, dict):
        if "jobDescription" in v:
            return v
        v = list(v.values())
    if isinstance(v, list):
        for x in v:
            found = _find_job(x)
            if found is not None:
                return found
    return None


def _resolve(v, rows, depth=0):
    if depth > 20:
        return v
    if isinstance(v, str):
        m = _REF_RX.fullmatch(v)
        return _resolve(rows[m.group(1)], rows, depth + 1) if m and m.group(1) in rows else _nfc(v)
    if isinstance(v, dict):
        return {k: _resolve(x, rows, depth + 1) for k, x in v.items()}
    if isinstance(v, list):
        return [_resolve(x, rows, depth + 1) for x in v]
    return v


def _job(doc):
    rows = _flight_rows(doc)            # NOT _nfc(doc): T-row lengths count the bytes as sent
    for row in rows.values():
        job = _find_job(row)
        if job is not None:
            return _resolve(job, rows)
    return None


def _text(fragment):
    """The JD fields are small HTML fragments: keep the line structure, drop the tags."""
    s = re.sub(r"<br\s*/?>|</(?:p|li|div|h\d)>", "\n", fragment or "", flags=re.I)
    s = re.sub(r"<li[^>]*>", "- ", s, flags=re.I)
    s = html.unescape(re.sub(r"<[^>]+>", "", s))
    return "\n".join(ln for ln in (re.sub(r"[ \t\xa0]+", " ", x).strip() for x in s.split("\n")) if ln)


def _jd_markdown(job):
    parts = []
    for head, key in (("Description", "jobDescription"), ("Requirements", "jobRequirement")):
        body = _text(job.get(key)) if isinstance(job.get(key), str) else ""
        if body:
            parts.append(f"## {head}\n{body}")
    benefits = []
    for b in job.get("benefits") or []:
        if isinstance(b, dict):
            name = b.get("benefitNameVI") or b.get("benefitName") or ""
            value = _text(b.get("benefitValue")).replace("\n", "\n  ")
            benefits.append(f"- {name}: {value}" if name else f"- {value}")
    if benefits:
        parts.append("## Benefits\n" + "\n".join(benefits))
    return "\n\n".join(parts) or None


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def import_url(url, timeout=20):
    return parse(fetch(url, timeout), url)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python -m lib.vietnamworks <job-url>")
    print(json.dumps(import_url(sys.argv[1]), ensure_ascii=False, indent=2))
