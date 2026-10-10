"""Import a job posting from a VietnamWorks URL.

WHY ONLY THE HEADER FIELDS: a VietnamWorks job page is a client-rendered SPA. The
HTML that `urlopen` returns carries ~100 characters of visible body text; the
responsibilities / requirements / benefits are fetched by JavaScript afterwards.
Everything we can get lives in the <meta og:*> tags, which follow one stable template:

    og:title       Tuyen {TITLE} tai {COMPANY} T{MM}/{YYYY}
    og:description {COMPANY} tuyen dung vi tri {TITLE} {LOCATION}, muc luong {SALARY}, ...

So: title/company/location/salary/id import automatically, the JD body is pasted by hand.
Validated against 4 unrelated live listings (see tests/test_vietnamworks.py).
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

    body = re.sub(r"<script.*?</script>|<style.*?</style>", "", doc, flags=re.S)
    out["_server_rendered_chars"] = len(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body)).strip())
    return out


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
