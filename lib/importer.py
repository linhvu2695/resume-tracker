"""Pick the right importer for a job URL.

    VietnamWorks          lib/vietnamworks.py  (og: meta + Next.js flight payload)
    anything else         lib/jobposting.py    (schema.org JobPosting: TopCV, ...)

A search-results page is the common mistake (it is what the address bar shows while
browsing), so it gets its own explanation instead of a generic failure.
"""
import re
from urllib.parse import urlparse

from lib import jobposting, vietnamworks


class NotAJobPage(ValueError):
    """The URL loaded, but it is not a single job posting. The message is user-facing."""


_JOB_ID = re.compile(r"(\d{5,})(?:\.html?)?/?$")


def _job_links(doc, host):
    """Distinct same-site links that end in a job id -- what a results list is made of."""
    ids = set()
    for href in re.findall(r'href=["\']([^"\']+)["\']', doc or ""):
        u = urlparse(href)
        if u.hostname and u.hostname.lower() != host:
            continue
        m = _JOB_ID.search(u.path)
        if m:
            ids.add(m.group(1))
    return ids


def parse_page(url, doc):
    host = (urlparse(url).hostname or "").lower()
    if "vietnamworks." in host:
        return vietnamworks.parse(doc, url)
    pos = jobposting.parse(doc, url)
    if pos:
        return pos
    # A job page also links to "related jobs"; only call it a list when the URL itself is not one job.
    if not _JOB_ID.search(urlparse(url).path) and len(_job_links(doc, host)) >= 3:
        raise NotAJobPage("That link is a list of jobs (search results), not one posting. "
                          "Open the job you want and use its link.")
    raise NotAJobPage("Found no job posting on that page. Fill the form in by hand below.")


def import_url(url, timeout=20):
    return parse_page(url, vietnamworks.fetch(url, timeout))


if __name__ == "__main__":
    import json
    import sys
    if len(sys.argv) < 2:
        sys.exit("usage: python -m lib.importer <job-url>")
    print(json.dumps(import_url(sys.argv[1]), ensure_ascii=False, indent=2))
