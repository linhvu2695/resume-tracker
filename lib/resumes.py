"""Resume versions and the differences between them.

A *version* is a distinct resume PDF, identified by a hash of its bytes -- so the same file
sent to five employers is one version used five times, not five resumes. Versions come
from two places:

    applications/<slug>/<name>.pdf     what was actually sent (rec["resume"])
    applications/_resumes/<sha>.pdf    the library: e.g. a base resume never sent as-is
    applications/_resumes/versions.yaml   {base: <sha>, versions: {<sha>: {label, file}}}

All of it lives under applications/, so it is gitignored with the rest of the personal data.

Diffs run on the extracted text (resume.txt), on *logical* lines: a PDF wraps a paragraph
wherever the layout says, and adding one word re-wraps every line after it. Re-joining
wrapped lines first means a diff shows what was written differently, not where it wrapped.
"""
import difflib
import hashlib
import re

import yaml

from lib import store

PIPELINE = ["draft", "applied", "screening", "interview", "offer"]
BULLET = re.compile(r"^[•●▪◦\-*–]\s")
PAIR_AT = 0.5        # word-similarity above which a removed + added line is "one line changed"
WRAPPED_AT = 0.85    # a physical line this close to the longest one probably wrapped


def lib_dir():
    return store.APPS / "_resumes"


def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()[:12]


def sha_of_record(rec):
    res = rec.get("resume") or {}
    if res.get("sha"):
        return res["sha"]
    pdf = store.path_for(rec["slug"]) / (res.get("file") or "")
    return sha_bytes(pdf.read_bytes()) if res.get("file") and pdf.is_file() else None


# ---- metadata (labels, which version is the base) -------------------------------

def load_meta():
    f = lib_dir() / "versions.yaml"
    try:
        meta = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    except OSError:
        meta = {}
    meta.setdefault("base", None)
    meta.setdefault("versions", {})
    return meta


def _save_meta(meta):
    d = lib_dir()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "versions.yaml.tmp"
    tmp.write_text(yaml.safe_dump(meta, allow_unicode=True, sort_keys=False), encoding="utf-8")
    tmp.replace(d / "versions.yaml")      # atomic, like store.save


def set_meta(sha, label=None, base=None):
    meta = load_meta()
    v = meta["versions"].setdefault(sha, {})
    if label is not None:
        v["label"] = label.strip() or None
    if base is True:
        meta["base"] = sha                 # one base at a time
    elif base is False and meta["base"] == sha:
        meta["base"] = None
    _save_meta(meta)
    return meta


def base_sha():
    return load_meta()["base"]


def add_to_library(pdf_bytes, name, text):
    """Store a resume that is not (yet) attached to an application -- typically the base."""
    sha = sha_bytes(pdf_bytes)
    d = lib_dir()
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{sha}.pdf").write_bytes(pdf_bytes)
    (d / f"{sha}.txt").write_text(text, encoding="utf-8")
    meta = load_meta()
    meta["versions"].setdefault(sha, {})["file"] = name
    _save_meta(meta)
    return sha


# ---- versions -------------------------------------------------------------------

def _reached(rec):
    """Furthest pipeline stage a record ever reached -- a rejection after an interview
    still counts as 'got an interview' for judging the resume."""
    seen = {rec.get("status")} | {e.get("to") for e in rec.get("events") or [] if e.get("type") == "status"}
    return max((PIPELINE.index(s) for s in seen if s in PIPELINE), default=0)


def versions(records):
    meta = load_meta()
    groups = {}

    def group(sha):
        return groups.setdefault(sha, {"sha": sha, "apps": [], "files": [], "first_used": None,
                                       "in_library": False, "_reach": -1})

    for r in records:
        sha = sha_of_record(r)
        if not sha:
            continue
        g = group(sha)
        pos = r.get("position") or {}
        g["apps"].append({"slug": r["slug"], "title": pos.get("title"), "company": pos.get("company"),
                          "status": r.get("status"), "applied_on": r.get("applied_on")})
        g["files"].append(f"/applications/{r['slug']}/{r['resume']['file']}")
        used = r.get("applied_on") or r.get("created_on")
        if used and (not g["first_used"] or used < g["first_used"]):
            g["first_used"] = used
        g["_reach"] = max(g["_reach"], _reached(r))
    if lib_dir().is_dir():
        for pdf in lib_dir().glob("*.pdf"):
            g = group(pdf.stem)
            g["in_library"] = True
            g["files"].insert(0, f"/applications/_resumes/{pdf.name}")

    out = []
    for sha, g in groups.items():
        m = meta["versions"].get(sha, {})
        name = m.get("file") or (g["files"][-1].rsplit("/", 1)[-1] if g["files"] else sha)
        g["label"] = m.get("label") or name.rsplit(".", 1)[0]
        g["is_base"] = sha == meta["base"]
        g["best"] = PIPELINE[g.pop("_reach")] if g["apps"] else None
        out.append(g)
    out.sort(key=lambda g: (not g["is_base"], -(int((g["first_used"] or "0").replace("-", "")))))
    return out


def text_for(sha, records):
    lib = lib_dir() / f"{sha}.txt"
    if lib.is_file():
        return lib.read_text(encoding="utf-8")
    for r in records:
        if sha_of_record(r) == sha:
            f = store.path_for(r["slug"]) / "resume.txt"
            if f.is_file():
                return f.read_text(encoding="utf-8")
    return None


# ---- diff -----------------------------------------------------------------------

def _heading(line):
    letters = [c for c in line if c.isalpha()]
    return bool(letters) and line.upper() == line and len(line) < 50


def logical_lines(text):
    """Re-join lines the PDF wrapped. A new logical line starts at a bullet or heading, after
    a heading, after a line ending a sentence, or after a line clearly shorter than the
    longest one (the paragraph ended there instead of wrapping)."""
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    if not lines:
        return []
    widest = max(len(ln) for ln in lines)
    out, prev = [], None
    for ln in lines:
        joins = (prev is not None and not BULLET.match(ln) and not _heading(ln) and not _heading(prev)
                 and not prev.endswith((".", ":", ";", "!", "?")) and len(prev) >= WRAPPED_AT * widest)
        if joins:
            out[-1] += " " + ln
        else:
            out.append(ln)
        prev = ln
    return out


def _words(line):
    return [(m.group(), m.start(), m.end()) for m in re.finditer(r"\S+", line)]


def _similar(a, b):
    return difflib.SequenceMatcher(None, a.split(), b.split(), autojunk=False).ratio()


def _marks(a, b):
    """Character spans of the words that differ, in a and in b."""
    wa, wb = _words(a), _words(b)
    sm = difflib.SequenceMatcher(None, [w for w, _, _ in wa], [w for w, _, _ in wb], autojunk=False)
    ma, mb = [], []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        if i2 > i1:
            ma.append([wa[i1][1], wa[i2 - 1][2]])
        if j2 > j1:
            mb.append([wb[j1][1], wb[j2 - 1][2]])
    return ma, mb


def diff(a_text, b_text):
    """Side-by-side rows: {tag: equal|insert|delete|replace, a, b, a_marks, b_marks}."""
    A, B = logical_lines(a_text), logical_lines(b_text)
    rows = []
    row = lambda tag, a, b, ma=(), mb=(): rows.append({"tag": tag, "a": a, "b": b,
                                                        "a_marks": list(ma), "b_marks": list(mb)})
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, A, B, autojunk=False).get_opcodes():
        if tag == "equal":
            for a, b in zip(A[i1:i2], B[j1:j2]):
                row("equal", a, b)
        elif tag == "delete":
            for a in A[i1:i2]:
                row("delete", a, None)
        elif tag == "insert":
            for b in B[j1:j2]:
                row("insert", None, b)
        else:
            # Pair each old line with the most similar new line still ahead of it; anything
            # unpaired is a plain delete / insert. Keeps order on both sides.
            j = j1
            for a in A[i1:i2]:
                best = max(range(j, j2), key=lambda k: _similar(a, B[k]), default=None)
                if best is None or _similar(a, B[best]) < PAIR_AT:
                    row("delete", a, None)
                    continue
                for b in B[j:best]:
                    row("insert", None, b)
                row("replace", a, B[best], *_marks(a, B[best]))
                j = best + 1
            for b in B[j:j2]:
                row("insert", None, b)
    count = lambda t: sum(r["tag"] == t for r in rows)
    return {"rows": rows, "added": count("insert"), "removed": count("delete"), "changed": count("replace")}
