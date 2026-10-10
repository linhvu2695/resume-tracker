"""Applications live on disk, one directory each. The directory IS the record.

    applications/<slug>/
        data.yaml      the record (status, dates, position, events)
        <resume>.pdf   what you actually attached to the email
        resume.txt     auto-extracted text (search / diff / tailoring)
        jd.md          the job description, pasted by hand

The PDF filename stays human-readable because you re-attach it from disk, but it
carries no meaning the app depends on -- data.yaml is the source of truth. That
matters here: real company names ("CONG TY TNHH ROTT VIET NAM") and titles
("HR & Administrative Executive / Nhan Vien HCNS") contain diacritics, slashes
and punctuation that do not survive a filename-as-database scheme.
"""
import datetime as _dt
import re
import unicodedata
from pathlib import Path

import yaml

BASE = Path(__file__).resolve().parent.parent
APPS = BASE / "applications"

STATUSES = ["draft", "applied", "screening", "interview", "offer", "rejected", "withdrawn"]
OPEN_STATUSES = {"draft", "applied", "screening", "interview"}
STALE_AFTER_DAYS = 10      # no movement for this long while open -> needs a nudge


def slugify(text, maxlen=40):
    """Vietnamese-aware: strip diacritics to ASCII, then punctuation to hyphens."""
    text = unicodedata.normalize("NFD", text or "")
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = text.replace("đ", "d").replace("Đ", "D")      # d-stroke has no combining form
    text = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()
    return text[:maxlen].strip("-")


def make_slug(position, when=None):
    when = when or _dt.date.today()
    month = position.get("posted") or when.strftime("%Y-%m")
    co = slugify(position.get("company", ""), 24)
    title = slugify(position.get("title", ""), 24)
    return "-".join(p for p in (month, co, title) if p)


def today():
    return _dt.date.today().isoformat()


def new_application(position, status="draft", applied_on=None):
    return {
        "status": status,
        "created_on": today(),
        "applied_on": applied_on,
        "follow_up_on": None,
        "position": position,
        "resume": None,
        "events": [{"on": today(), "type": "created"}],
        "contacts": [],
        "notes": "",
    }


def path_for(slug):
    return APPS / slug


def save(slug, record):
    d = path_for(slug)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "data.yaml.tmp"
    with tmp.open("w", encoding="utf-8") as f:
        yaml.safe_dump(record, f, allow_unicode=True, sort_keys=False, width=100)
    tmp.replace(d / "data.yaml")        # atomic: never leave a half-written record
    return d


def load(slug):
    f = path_for(slug) / "data.yaml"
    if not f.exists():
        return None
    rec = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    rec["slug"] = slug
    d = path_for(slug)
    pdfs = sorted(p.name for p in d.glob("*.pdf"))
    rec["pdfs"] = pdfs
    rec["has_text"] = (d / "resume.txt").exists()
    rec["has_jd"] = (d / "jd.md").exists()
    return rec


def all_slugs():
    if not APPS.exists():
        return []
    return sorted(p.name for p in APPS.iterdir() if p.is_dir() and (p / "data.yaml").exists())


def load_all():
    return [r for r in (load(s) for s in all_slugs()) if r]


def last_activity(rec):
    """ISO date of the most recent event, falling back to applied/created."""
    dates = [e.get("on") for e in (rec.get("events") or []) if e.get("on")]
    dates += [d for d in (rec.get("applied_on"), rec.get("created_on")) if d]
    return max(dates) if dates else None


def days_since(iso, as_of=None):
    """as_of is threaded through rather than read from the clock, so the whole
    recommendation layer is testable against a fixed date."""
    if not iso:
        return None
    try:
        return ((as_of or _dt.date.today()) - _dt.date.fromisoformat(iso)).days
    except ValueError:
        return None


def needs_attention(rec, as_of=None):
    """The recommendation primitive. Mirrors interview-prep's `Review.recommend`:
    return a reason string when this record wants action today, else None."""
    as_of = as_of or _dt.date.today()
    if rec.get("status") not in OPEN_STATUSES:
        return None
    fu = rec.get("follow_up_on")
    if fu:
        try:
            overdue = (as_of - _dt.date.fromisoformat(fu)).days
            if overdue >= 0:
                return f"follow-up due{'' if overdue == 0 else f' ({overdue}d overdue)'}"
        except ValueError:
            pass
    if rec.get("status") == "draft":
        return "draft - not sent yet"
    idle = days_since(last_activity(rec), as_of)
    if idle is not None and idle >= STALE_AFTER_DAYS:
        return f"no movement in {idle}d"
    return None


def dashboard(records=None, as_of=None):
    as_of = as_of or _dt.date.today()
    records = load_all() if records is None else records
    by_status = {s: 0 for s in STATUSES}
    attention = []
    for r in records:
        by_status[r.get("status", "draft")] = by_status.get(r.get("status", "draft"), 0) + 1
        why = needs_attention(r, as_of)
        if why:
            attention.append({"slug": r["slug"], "why": why,
                              "title": (r.get("position") or {}).get("title"),
                              "company": (r.get("position") or {}).get("company"),
                              "idle_days": days_since(last_activity(r), as_of)})
    attention.sort(key=lambda a: -(a["idle_days"] or 0))
    return {"total": len(records), "by_status": by_status,
            "open": sum(by_status[s] for s in OPEN_STATUSES), "attention": attention}
